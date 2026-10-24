"use strict";
const { DEFAULT_CONFIG } = require("./config");
const { checkInput } = require("./agents/inputGuard");
const { readScreen, readVisual } = require("./agents/reader");
const { crossCheck } = require("./agents/crossCheck");
const { buildFacts, writeNarrative } = require("./agents/writer");
const { prepareFrames: defaultPrepareFrames } = require("./frames");

/**
 * Orquestrador (harness) do agente de ultrassonografia.
 *
 *   entrada → Guarda → Preparo dos quadros → Leitor de tela → Leitor visual
 *           → Cruzamento → Redator → Verificador → rascunho
 *
 * Fontes mantidas separadas no resultado: cadastro (request.animal),
 * histórico (request.history), texto da tela (screen), observação visual
 * (visual.structures), interpretação sugerida (visual.preliminary_interpretation).
 * Nada é gravado: o rascunho só vira prontuário com a assinatura do veterinário.
 */

/** Medidas feitas na tela → campos do prontuário. Só medida escrita entra. */
function measurementsFromScreen(screen) {
  const out = { gestational_age_days: null, corpus_luteum_mm: null, follicle_largest_mm: null };
  for (const m of screen.measurements || []) {
    const label = String(m.label || "").toUpperCase();
    const unit = String(m.unit || "").toLowerCase();
    const mm = unit === "cm" ? m.value * 10 : unit === "mm" ? m.value : null;
    if (/^(IG|GA)\b/.test(label)) {
      const d = /sem|wk|week/.test(unit) ? m.value * 7 : /^d|dia|day/.test(unit) ? m.value : null;
      if (d != null && d > 0) out.gestational_age_days = { label: m.label, value: Math.round(d) };
    } else if (/^CL\b|CORPO/.test(label) && mm != null && mm > 0) out.corpus_luteum_mm = { label: m.label, value: Math.round(mm * 10) / 10 };
    else if (/^(FOL|F\d)\b|FOLIC/.test(label) && mm != null && mm > 0) {
      if (!out.follicle_largest_mm || mm > out.follicle_largest_mm.value) out.follicle_largest_mm = { label: m.label, value: Math.round(mm * 10) / 10 };
    }
  }
  return out;
}

async function runUltrasoundAgent(request, { vlmClient, writerClient = null, config = {}, now = () => new Date(), prepareFrames = defaultPrepareFrames } = {}) {
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
  if (!vlmClient) return finish("sem_modelo", { problems: ["Leitor de imagens não configurado (GEMINI_API_KEY)."] });

  // 2. Preparo dos quadros (falha de processamento ≠ ausência de achados)
  let prepared;
  try {
    prepared = await prepareFrames(request.media, { framesPerVideo: cfg.framesPerVideo });
    if (!prepared.frames.length) throw new Error("nenhum quadro extraído");
    step("preparo_dos_quadros", { ok: true, frames: prepared.frames.length, coverage: prepared.coverage });
  } catch (error) {
    step("preparo_dos_quadros", { ok: false, error: error.message });
    return finish("falha_no_processamento", { problems: [`Não foi possível extrair os quadros do arquivo: ${error.message}`] });
  }
  const { frames, coverage } = prepared;

  // 3 e 4. Leitores (entradas separadas)
  const onStep = (name, s) => step(name, { model: vlmClient.model, ...s });
  let screen, visual;
  try {
    const s = await readScreen({ client: vlmClient, frames, attempts: cfg.maxVlmAttempts, onStep });
    if (!s.ok) return finish("leitura_invalida", { problems: ["O leitor de tela não devolveu um resultado válido.", ...s.errors.slice(0, 5)], coverage });
    screen = s.output;
    const v = await readVisual({ client: vlmClient, frames, species: request.exam.species || "bovina", attempts: cfg.maxVlmAttempts, onStep });
    if (!v.ok) return finish("leitura_invalida", { problems: ["O leitor visual não devolveu um resultado válido.", ...v.errors.slice(0, 5)], coverage });
    visual = v.output;
  } catch (error) {
    step("leitor", { ok: false, error: error.message });
    return finish("falha_no_modelo", { problems: [error.message], coverage });
  }

  // 5. Cruzamento das fontes
  const measurements = measurementsFromScreen(screen);
  const gestationShown = visual.gestation.status === "estruturas gestacionais identificadas";
  const derived = {
    measurements,
    gestation_status: visual.gestation.status,
    gestational_age_status: measurements.gestational_age_days ? "medida na tela" : "não estimável",
    no_findings: !visual.structures.some((s) => s.identification_status !== "não identificado com segurança")
  };
  const cross = crossCheck({ screen, visual, derived, animal: request.animal, exam: request.exam, history: request.history, config: cfg });
  step("cruzamento", { ok: true, blocked: cross.blocked, checks: cross.checks.map((c) => ({ code: c.code, severity: c.severity })) });

  // 6 e 7. Redator + Verificador
  const facts = buildFacts({ visual, derived, animal: request.animal, exam: request.exam, cross, coverage });
  const written = await writeNarrative({ client: writerClient, facts, onStep: (s) => step("redator", { model: writerClient?.model, ...s }) });
  step("verificador", { ok: written.verification.ok, source: written.source, unknownNumbers: written.verification.unknownNumbers });

  // Campos do exame (ultrasound_exams). Gestação só é sugerida quando o leitor
  // visual mostrou a estrutura; nos demais casos fica para o veterinário.
  const draft = {
    animal_id: request.animal.id,
    exam_date: request.exam.date,
    veterinarian_name: request.exam.veterinarianName || "",
    equipment: request.exam.equipment || screen.equipment || "",
    pregnancy: gestationShown ? "Prenhe" : "",
    gestational_age_days: measurements.gestational_age_days?.value ?? null,
    corpus_luteum_mm: measurements.corpus_luteum_mm?.value ?? null,
    diameter_mm: measurements.follicle_largest_mm?.value ?? null,
    uterine_horn: "",
    fluid_presence: "",
    ai_enabled: "Sim",
    ai_confidence: null,
    notes: written.narrative
  };

  return finish("rascunho_aguardando_veterinario", {
    draft, screen, visual, derived, coverage,
    frames: frames.map((f) => ({ index: f.index, media: f.media, time_s: f.time_s, thumb: `data:image/jpeg;base64,${f.thumb.toString("base64")}` })),
    checks: cross.checks,
    history: { lastService: cross.lastService, previousExam: cross.previousExam },
    blocked: cross.blocked,
    narrativeSource: written.source,
    requiresVeterinarianApproval: true,
    provenance: { promptVersion: cfg.promptVersion, vlmModel: vlmClient.model, writerModel: writerClient?.model || null, roi: prepared.roi, media: input.media.map((m) => ({ sha256: m.sha256, mimeType: m.mimeType, bytes: m.bytes })) }
  });
}

module.exports = { runUltrasoundAgent, measurementsFromScreen };
