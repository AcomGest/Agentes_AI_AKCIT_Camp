"use strict";
/**
 * Testes do agente com um modelo falso (sem chamar o Gemini). Cobrem a guarda
 * de entrada, a validação do contrato com nova tentativa, o cruzamento com o
 * histórico, o bloqueio de número estimado a olho e o Verificador da narrativa.
 *
 *   node agents/ultrasound-agent/test/harness.test.js
 */
const assert = require("node:assert/strict");
const { runUltrasoundAgent } = require("../src/harness");
const { verifyNarrative } = require("../src/agents/writer");
const { SIMULATED_READING } = require("../src/simulated");

const clone = (v) => JSON.parse(JSON.stringify(v));
const fakeClient = (...responses) => {
  let i = 0;
  return { model: "falso", calls: 0, async generate() { this.calls++; const r = responses[Math.min(i++, responses.length - 1)]; if (r instanceof Error) throw r; return { text: typeof r === "string" ? r : JSON.stringify(r), usage: { inputTokens: 10, outputTokens: 5, ms: 1 } }; } };
};
const png = { mimeType: "image/png", buffer: Buffer.from("imagem-de-teste") };
const base = { animal: { id: "a1", tag: "1042" }, exam: { date: "2026-10-20", equipment: "Aparelho X" }, media: [png], history: { services: [{ date: "2026-09-05", type: "IATF" }], ultrasounds: [] } };

(async () => {
  // 1. Entrada recusada antes de gastar IA
  let client = fakeClient(SIMULATED_READING);
  let out = await runUltrasoundAgent({ ...base, media: [{ mimeType: "application/pdf", buffer: Buffer.from("x") }] }, { vlmClient: client });
  assert.equal(out.status, "entrada_recusada");
  assert.equal(client.calls, 0, "não chama o modelo com entrada inválida");
  console.log("Guarda de entrada recusa tipo de arquivo sem chamar o modelo: OK");

  // 2. Caminho feliz: idade gestacional coerente com o serviço (45 dias)
  out = await runUltrasoundAgent(base, { vlmClient: fakeClient(SIMULATED_READING) });
  assert.equal(out.status, "rascunho_aguardando_veterinario");
  assert.equal(out.requiresVeterinarianApproval, true);
  assert.equal(out.draft.pregnancy, "Prenhe");
  assert.equal(out.draft.gestational_age_days, 45);
  assert.equal(out.draft.ai_enabled, "Sim");
  assert(out.checks.some((c) => c.code === "idade_gestacional_coerente"));
  assert.equal(out.blocked, false);
  assert.deepEqual(out.trace.steps.map((s) => s.name), ["guarda_de_entrada", "leitor_vlm", "cruzamento", "verificador"]);
  console.log("Leitura coerente com o histórico vira rascunho aguardando o veterinário: OK");

  // 3. Resposta fora do contrato: nova tentativa com o erro; se persistir, falha fechada
  client = fakeClient("não é json", SIMULATED_READING);
  out = await runUltrasoundAgent(base, { vlmClient: client });
  assert.equal(out.status, "rascunho_aguardando_veterinario");
  assert.equal(client.calls, 2);
  out = await runUltrasoundAgent(base, { vlmClient: fakeClient("não é json") });
  assert.equal(out.status, "leitura_invalida");
  console.log("Contrato inválido: 1 nova tentativa, depois falha fechada sem rascunho: OK");

  // 4. Falha de rede no modelo não derruba o fluxo
  out = await runUltrasoundAgent(base, { vlmClient: fakeClient(new Error("Gemini não respondeu em 60s.")) });
  assert.equal(out.status, "falha_no_modelo");
  console.log("Falha do modelo vira status explícito: OK");

  // 5. Divergências do cruzamento
  const reading = clone(SIMULATED_READING);
  reading.screen_text.animal_id = "0999";
  reading.findings.gestational_age_days.value = 80;
  reading.findings.corpus_luteum_mm = { value: 30, confidence: 0.4, evidence: "a olho", source: "observacao_visual" };
  out = await runUltrasoundAgent(base, { vlmClient: fakeClient(reading) });
  const codes = out.checks.map((c) => c.code);
  assert(codes.includes("animal_divergente"));
  assert(codes.includes("idade_gestacional_divergente"));
  assert(codes.includes("medida_sem_tela"));
  assert(codes.includes("baixa_confianca"));
  assert.equal(out.blocked, true);
  assert.equal(out.draft.corpus_luteum_mm, null, "número estimado a olho não entra no rascunho");
  console.log("Animal divergente, idade gestacional fora do serviço e medida sem tela: bloqueado: OK");

  // 6. Prenhe sem serviço registrado e vazia após exame positivo
  out = await runUltrasoundAgent({ ...base, history: { services: [], ultrasounds: [] } }, { vlmClient: fakeClient(SIMULATED_READING) });
  assert(out.checks.some((c) => c.code === "prenhe_sem_servico"));
  const empty = clone(SIMULATED_READING);
  empty.findings.pregnancy.value = "vazia";
  empty.findings.gestational_age_days = { value: null, confidence: 0, evidence: "", source: "nao_visivel" };
  out = await runUltrasoundAgent({ ...base, history: { services: [], ultrasounds: [{ date: "2026-09-01", pregnancy: "prenhe" }] } }, { vlmClient: fakeClient(empty) });
  assert(out.checks.some((c) => c.code === "vazia_apos_positivo"));
  console.log("Prenhe sem serviço e vazia após positivo geram alertas: OK");

  // 7. Verificador recusa número inventado e recomendação; Redator cai no modelo determinístico
  const facts = { exam: { date: "2026-10-20" }, findings: { gestational_age_days: { value: 45 } } };
  assert.equal(verifyNarrative("Gestação de 45 dias em 2026-10-20.", facts).ok, true);
  assert.equal(verifyNarrative("Gestação de 52 dias.", facts).ok, false);
  assert.equal(verifyNarrative("Recomenda-se aplicar 2 mL.", facts).ok, false);
  const writer = fakeClient("Prenhe de 60 dias, recomendo vacinar.");
  out = await runUltrasoundAgent(base, { vlmClient: fakeClient(SIMULATED_READING), writerClient: writer });
  assert.equal(out.narrativeSource, "modelo_deterministico");
  assert(!out.draft.notes.includes("60 dias"));
  console.log("Verificador descarta narrativa com número inventado ou recomendação: OK");

  console.log("ultrasound-agent harness.test: OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
