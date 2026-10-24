"use strict";
const { DEFAULT_CONFIG } = require("./config");
const { checkInput } = require("./agents/inputGuard");
const { readMedia } = require("./agents/reader");
const { crossCheck } = require("./agents/crossCheck");
const { buildFacts, writeNarrative } = require("./agents/writer");

/**
 * Orquestrador (harness) do agente de ultrassonografia.
 *
 *   entrada → Guarda → Leitor (VLM) → Cruzamento → Redator → Verificador → rascunho
 *
 * Estado compartilhado: um único objeto `run` com o rastro de cada etapa
 * (entrada resumida, saída, tempo, tokens, tentativas). Nenhuma etapa grava
 * no sistema: a saída é um rascunho que só vira prontuário quando o
 * médico-veterinário aprova (fora deste módulo).
 */
async function runUltrasoundAgent(request, { vlmClient, writerClient = null, config = {}, now = () => new Date() } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, media: { ...DEFAULT_CONFIG.media, ...(config.media || {}) }, ranges: { ...DEFAULT_CONFIG.ranges, ...(config.ranges || {}) } };
  const run = { startedAt: now().toISOString(), promptVersion: cfg.promptVersion, steps: [], status: "running" };
  const step = (name, data) => {
    if (run.steps.length >= cfg.maxSteps) throw new Error("Limite de etapas do agente atingido.");
    run.steps.push({ name, at: now().toISOString(), ...data });
  };
  const finish = (status, extra = {}) => {
    run.status = status;
    run.finishedAt = now().toISOString();
    run.usage = run.steps.reduce((acc, s) => ({ inputTokens: acc.inputTokens + (s.usage?.inputTokens || 0), outputTokens: acc.outputTokens + (s.usage?.outputTokens || 0) }), { inputTokens: 0, outputTokens: 0 });
    return { status, ...extra, trace: run };
  };

  // 1. Guarda de entrada
  const input = checkInput(request, cfg);
  step("guarda_de_entrada", { ok: input.ok, problems: input.problems, media: input.media });
  if (!input.ok) return finish("entrada_recusada", { problems: input.problems });

  // 2. Leitor (VLM)
  if (!vlmClient) return finish("sem_modelo", { problems: ["Leitor de imagens não configurado (GEMINI_API_KEY)."] });
  let reading;
  try {
    const result = await readMedia({ client: vlmClient, media: request.media, exam: request.exam, attempts: cfg.maxVlmAttempts, onStep: (s) => step("leitor_vlm", { model: vlmClient.model, ...s }) });
    if (!result.ok) return finish("leitura_invalida", { problems: ["O modelo não devolveu uma leitura válida.", ...result.errors.slice(0, 5)] });
    reading = result.output;
  } catch (error) {
    step("leitor_vlm", { ok: false, error: error.message });
    return finish("falha_no_modelo", { problems: [error.message] });
  }

  // 3. Cruzamento com o histórico
  const cross = crossCheck({ reading, animal: request.animal, exam: request.exam, history: request.history, config: cfg });
  step("cruzamento", { ok: true, blocked: cross.blocked, checks: cross.checks.map((c) => ({ code: c.code, severity: c.severity })) });

  // 4. Redator + Verificador
  const facts = buildFacts({ reading, animal: request.animal, exam: request.exam, cross });
  const written = await writeNarrative({ client: writerClient, facts, onStep: (s) => step("redator", { model: writerClient?.model, ...s }) });
  step("verificador", { ok: written.verification.ok, source: written.source, unknownNumbers: written.verification.unknownNumbers });

  const f = reading.findings;
  const lowConfidence = Object.entries(f).filter(([, x]) => x.value !== null && x.confidence < cfg.minConfidence).map(([k]) => k);
  const confidences = Object.values(f).filter((x) => x.value !== null).map((x) => x.confidence);
  const blockedMeasures = new Set(cross.checks.filter((c) => c.code === "medida_sem_tela").map((c) => c.data.field));
  const measure = (key) => (blockedMeasures.has(key) ? null : f[key].value);

  // Campos no formato do exame de ultrassom da AcomGest (ultrasound_exams).
  const draft = {
    animal_id: request.animal.id,
    exam_date: request.exam.date,
    veterinarian_name: request.exam.veterinarianName || "",
    equipment: request.exam.equipment || reading.screen_text.equipment || "",
    pregnancy: f.pregnancy.value === "prenhe" ? "Prenhe" : f.pregnancy.value === "vazia" ? "Vazia" : f.pregnancy.value === "indeterminado" ? "Indeterminado" : "",
    gestational_age_days: measure("gestational_age_days"),
    corpus_luteum_mm: measure("corpus_luteum_mm"),
    diameter_mm: measure("follicle_largest_mm"),
    uterine_horn: f.uterine_horn.value || "",
    fluid_presence: f.fluid_presence.value === "sim" ? "Sim" : f.fluid_presence.value === "nao" ? "Não" : "",
    ai_enabled: "Sim",
    ai_confidence: confidences.length ? Math.round(Math.min(...confidences) * 100) / 100 : null,
    notes: written.narrative
  };

  return finish("rascunho_aguardando_veterinario", {
    draft,
    reading,
    checks: cross.checks,
    lowConfidence,
    blocked: cross.blocked,
    narrativeSource: written.source,
    requiresVeterinarianApproval: true,
    provenance: { promptVersion: cfg.promptVersion, vlmModel: vlmClient.model, writerModel: writerClient?.model || null, media: input.media.map((m) => ({ sha256: m.sha256, mimeType: m.mimeType, bytes: m.bytes })) }
  });
}

module.exports = { runUltrasoundAgent };
