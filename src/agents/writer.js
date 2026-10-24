"use strict";

/**
 * Agente Redator + Verificador.
 *
 * O Redator (LLM) escreve a narrativa do prontuário só a partir dos fatos
 * estruturados. O Verificador (determinístico) confere que todo número e toda
 * data da narrativa existem nos fatos; se não, a narrativa do LLM é descartada
 * e entra o texto-modelo determinístico. Assim o prontuário nunca carrega um
 * número inventado.
 */
const LABELS = {
  pregnancy: "Gestação", gestational_age_days: "Idade gestacional (dias)", corpus_luteum_mm: "Corpo lúteo (mm)",
  follicle_largest_mm: "Maior folículo (mm)", uterine_horn: "Corno uterino", fluid_presence: "Líquido", fetal_heartbeat: "Batimento cardíaco fetal"
};

// Valores do contrato em português legível para o texto do laudo.
const HUMAN = { prenhe: "prenhe", vazia: "vazia", indeterminado: "indeterminada", sim: "presente", nao: "ausente", visivel: "visível", nao_visivel: "não visualizado", direito: "direito", esquerdo: "esquerdo", ambos: "ambos" };

function buildFacts({ reading, animal, exam, cross }) {
  const findings = Object.fromEntries(Object.entries(reading.findings).filter(([, f]) => f.value !== null).map(([k, f]) => [LABELS[k] || k, { valor: HUMAN[f.value] ?? f.value, evidencia: f.evidence }]));
  const checks = cross.checks.filter((c) => c.severity !== "info").map((c) => c.message);
  return {
    animal: { tag: animal.tag, name: animal.name || null, category: animal.category || null },
    exam: { date: exam.date, equipment: exam.equipment || reading.screen_text.equipment || null, veterinarian: exam.veterinarianName || null },
    findings,
    ...(checks.length ? { pontos_de_conferencia: checks } : {}),
    last_service: cross.lastService,
    previous_exam: cross.previousExam
  };
}

function templateNarrative(facts) {
  const lines = [`Exame ultrassonográfico do animal ${facts.animal.tag} em ${facts.exam.date}${facts.exam.equipment ? `, aparelho ${facts.exam.equipment}` : ""}.`];
  const found = Object.entries(facts.findings).map(([k, f]) => `${k}: ${f.valor}`);
  lines.push(found.length ? `Achados lidos nas imagens: ${found.join("; ")}.` : "Nenhum achado legível nas imagens.");
  if (facts.pontos_de_conferencia?.length) lines.push(`Pontos para conferência do veterinário: ${facts.pontos_de_conferencia.join(" ")}`);
  lines.push("Rascunho gerado por agente de IA; sem validade clínica até a aprovação do médico-veterinário responsável.");
  return lines.join(" ");
}

const NUM = /\d+(?:[.,]\d+)?/g;

/** Todo número da narrativa precisa aparecer nos fatos (datas contam pelos seus números). */
function verifyNarrative(narrative, facts) {
  const allowed = new Set((JSON.stringify(facts).match(NUM) || []).map((n) => n.replace(",", ".")));
  const unknown = (narrative.match(NUM) || []).map((n) => n.replace(",", ".")).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
  const forbidden = /\b(recomend|prescrev|tratar com|administrar|aplicar \d|dose de|diagnóstico definitivo)/i.test(narrative);
  return { ok: unknown.length === 0 && !forbidden, unknownNumbers: [...new Set(unknown)], forbiddenTerms: forbidden };
}

const WRITER_INSTRUCTIONS = [
  "Você redige o rascunho de prontuário de um exame de ultrassonografia de bovino, em português, em até 6 frases.",
  "Use somente os fatos do JSON recebido. Não acrescente número, data, achado, causa, diagnóstico, prognóstico, tratamento ou recomendação.",
  "Escreva as datas no formato DD/MM/AAAA. Se houver pontos_de_conferencia, cite-os; se não houver, não mencione. Não copie nomes de campos nem valores técnicos entre aspas. Termine dizendo que o rascunho só vale após aprovação do médico-veterinário."
].join("\n");

async function writeNarrative({ client, facts, onStep = () => {} }) {
  const fallback = templateNarrative(facts);
  if (!client) return { narrative: fallback, source: "modelo_deterministico", verification: { ok: true, unknownNumbers: [], forbiddenTerms: false } };
  try {
    const { text, usage } = await client.generate({ instructions: WRITER_INSTRUCTIONS, parts: [{ text: JSON.stringify(facts) }] });
    const narrative = text.trim();
    const verification = verifyNarrative(narrative, facts);
    onStep({ ok: verification.ok, usage, verification });
    if (verification.ok) return { narrative, source: "redator_llm", verification };
    return { narrative: fallback, source: "modelo_deterministico", verification, rejectedNarrative: narrative };
  } catch (error) {
    onStep({ ok: false, error: error.message });
    return { narrative: fallback, source: "modelo_deterministico", verification: { ok: true, unknownNumbers: [], forbiddenTerms: false }, writerError: error.message };
  }
}

module.exports = { buildFacts, templateNarrative, verifyNarrative, writeNarrative, LABELS };
