"use strict";
/**
 * Testes do agente com leitores falsos (sem chamar o Gemini) e quadros falsos
 * (sem ffmpeg). Cobrem: guarda de entrada, falha de processamento × ausência
 * de achados, contrato inválido com nova tentativa, separação das fontes
 * (texto da tela não vira nome do animal; cadastro não entra no leitor
 * visual), quadros de referência, medidas só da tela, Verificador.
 *
 *   node agents/ultrasound-agent/test/harness.test.js
 */
const assert = require("node:assert/strict");
const { runUltrasoundAgent } = require("../src/harness");
const { verifyNarrative } = require("../src/agents/writer");
const { SIMULATED_SCREEN, SIMULATED_VISUAL, simulatedFrames } = require("../src/simulated");

const clone = (v) => JSON.parse(JSON.stringify(v));
/** Leitor falso: responde pelo contrato pedido e guarda o que recebeu. */
const fakeClient = ({ screen = SIMULATED_SCREEN, visual = SIMULATED_VISUAL, visualRaw } = {}) => ({
  model: "falso", calls: [],
  async generate({ instructions, parts, schema }) {
    const isVisual = Boolean(schema?.properties?.structures);
    this.calls.push({ isVisual, instructions, text: parts.filter((p) => p.text).map((p) => p.text).join(" ") });
    if (visual instanceof Error && isVisual) throw visual;
    const body = isVisual ? (visualRaw !== undefined ? visualRaw.shift() ?? JSON.stringify(visual) : JSON.stringify(visual)) : JSON.stringify(screen);
    return { text: body, usage: { inputTokens: 10, outputTokens: 5, ms: 1 } };
  }
});
const png = { mimeType: "image/png", buffer: Buffer.from("imagem-de-teste") };
const base = { animal: { id: "a1", tag: "1042", name: "Mimosa" }, exam: { date: "2026-10-20" }, media: [png], history: { services: [{ date: "2026-09-05", type: "IATF" }], ultrasounds: [] } };
const opts = (client, extra = {}) => ({ vlmClient: client, prepareFrames: simulatedFrames, ...extra });

(async () => {
  // 1. Entrada recusada antes de gastar IA
  let client = fakeClient();
  let out = await runUltrasoundAgent({ ...base, media: [{ mimeType: "application/pdf", buffer: Buffer.from("x") }] }, opts(client));
  assert.equal(out.status, "entrada_recusada");
  assert.equal(client.calls.length, 0);
  console.log("Guarda de entrada recusa tipo de arquivo sem chamar o modelo: OK");

  // 2. Falha de processamento ≠ ausência de achados
  out = await runUltrasoundAgent(base, opts(fakeClient(), { prepareFrames: async () => { throw new Error("vídeo ilegível"); } }));
  assert.equal(out.status, "falha_no_processamento");
  const empty = clone(SIMULATED_VISUAL);
  empty.structures = []; empty.gestation = { status: "não demonstrada neste clipe", frames: [], basis: "nada visível" };
  out = await runUltrasoundAgent(base, opts(fakeClient({ visual: empty })));
  assert.equal(out.status, "rascunho_aguardando_veterinario");
  assert.equal(out.derived.no_findings, true);
  console.log("Falha de processamento e ausência de achados têm status diferentes: OK");

  // 3. Caminho feliz: fontes separadas
  client = fakeClient();
  out = await runUltrasoundAgent(base, opts(client));
  assert.equal(out.status, "rascunho_aguardando_veterinario");
  const visualCall = client.calls.find((c) => c.isVisual);
  assert(!/1042|Mimosa|IATF|Paciente X/.test(visualCall.text + visualCall.instructions), "leitor visual não recebe cadastro, histórico nem texto da tela");
  assert.deepEqual(out.trace.steps.map((s) => s.name), ["guarda_de_entrada", "preparo_dos_quadros", "leitor_de_tela", "leitor_visual", "cruzamento", "verificador"]);
  assert.equal(out.draft.gestational_age_days, 45, "idade gestacional só da medida da tela");
  assert.equal(out.draft.pregnancy, "Prenhe", "sugestão só porque o leitor visual mostrou a estrutura");
  assert.equal(out.frames.length, 2);
  assert(out.frames[0].thumb.startsWith("data:image/jpeg;base64,"));
  console.log("Leitor visual sem cadastro, histórico ou texto; medidas só da tela; quadros devolvidos: OK");

  // 4. Texto da tela não vira nome do animal: conferência, não bloqueio
  assert(out.checks.some((c) => c.code === "identificacao_a_conferir" && c.severity === "alerta" && /significado desse texto não está confirmado/.test(c.message)));
  assert.equal(out.blocked, false);
  const sameName = clone(SIMULATED_SCREEN); sameName.texts[0].text = "1042";
  out = await runUltrasoundAgent(base, opts(fakeClient({ screen: sameName })));
  assert(out.checks.some((c) => c.code === "identificacao_confere"));
  console.log("Texto da tela com significado não confirmado vira conferência: OK");

  // 5. Data divergente mostra as duas, sem decidir
  const otherDate = clone(SIMULATED_SCREEN); otherDate.exam_date = "22/10/2025";
  out = await runUltrasoundAgent(base, opts(fakeClient({ screen: otherDate })));
  const dateCheck = out.checks.find((c) => c.code === "data_a_conferir");
  assert(dateCheck && /22\/10\/2025/.test(dateCheck.message) && /20\/10\/2026/.test(dateCheck.message));
  console.log("Datas divergentes: as duas mostradas para conferência: OK");

  // 6. Estrutura "identificada" sem quadro vira hipótese; gestação sem quadro vira inconclusiva
  const noFrames = clone(SIMULATED_VISUAL); noFrames.structures[0].frames = [9]; noFrames.gestation.frames = [];
  out = await runUltrasoundAgent(base, opts(fakeClient({ visual: noFrames })));
  assert.equal(out.visual.structures[0].identification_status, "hipótese");
  assert.equal(out.visual.gestation.status, "inconclusiva");
  assert.equal(out.draft.pregnancy, "", "sem estrutura demonstrada, gestação fica para o veterinário");
  console.log("Afirmação visual sem quadro conferível é rebaixada: OK");

  // 7. Contrato inválido: 1 nova tentativa, depois falha fechada
  client = fakeClient({ visualRaw: ["não é json"] });
  out = await runUltrasoundAgent(base, opts(client));
  assert.equal(out.status, "rascunho_aguardando_veterinario");
  assert.equal(client.calls.filter((c) => c.isVisual).length, 2);
  out = await runUltrasoundAgent(base, opts(fakeClient({ visualRaw: ["x", "y"] })));
  assert.equal(out.status, "leitura_invalida");
  out = await runUltrasoundAgent(base, opts(fakeClient({ visual: new Error("Gemini não respondeu") })));
  assert.equal(out.status, "falha_no_modelo");
  console.log("Contrato inválido e falha do modelo: status explícitos: OK");

  // 8. Histórico só contextualiza: positivo anterior + clipe sem gestação ≠ negativo
  out = await runUltrasoundAgent({ ...base, history: { services: [], ultrasounds: [{ date: "2026-09-01", pregnancy: "prenhe" }] } }, opts(fakeClient({ visual: empty })));
  assert(out.checks.some((c) => c.code === "positivo_anterior" && /não equivale a resultado negativo/.test(c.message)));
  console.log("Clipe sem gestação após positivo: alerta sem virar negativo: OK");

  // 9. Sem recorte: leitor visual avisado e alerta para o veterinário
  const uncroppedFrames = async (media) => { const p = await simulatedFrames(media); p.frames.forEach((f) => { f.cropped = false; }); return p; };
  client = fakeClient();
  out = await runUltrasoundAgent(base, opts(client, { prepareFrames: uncroppedFrames }));
  assert(/não foi isolada/.test(client.calls.find((c) => c.isVisual).text), "leitor visual avisado");
  assert(out.checks.some((c) => c.code === "recorte_nao_encontrado" && c.severity === "alerta"));
  out = await runUltrasoundAgent(base, opts(fakeClient()));
  assert(!out.checks.some((c) => c.code === "recorte_nao_encontrado"), "com recorte, sem alerta");
  console.log("Sem recorte da imagem: leitor avisado e alerta de conferência: OK");

  // 10. Verificador
  const facts = { exame: { data: "2026-10-20" }, achados: [{ quadros: [1, 2, 3] }] };
  assert.equal(verifyNarrative("Quadros 1 a 3, em 20/10/2026.", facts).ok, true, "lista [1,2,3] não vira decimal");
  assert.equal(verifyNarrative("Gestação de 52 dias.", facts).ok, false);
  assert.equal(verifyNarrative("Recomenda-se aplicar 2 mL.", facts).ok, false);
  console.log("Verificador aceita números dos fatos e recusa inventados ou recomendação: OK");

  console.log("ultrasound-agent harness.test: OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
