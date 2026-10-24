"use strict";

/**
 * Agente Redator + Verificador.
 *
 * O Redator (LLM) escreve a narrativa do rascunho só com os fatos: achados
 * visuais (com os quadros), limitações, cobertura da amostragem, medidas da
 * tela e pontos de conferência. Cadastro e histórico entram só como contexto
 * rotulado, nunca como achado. O Verificador (determinístico) confere que todo
 * número da narrativa existe nos fatos e recusa termos de recomendação; se
 * reprovar, entra o texto-modelo determinístico.
 */
function buildFacts({ visual, derived, animal, exam, cross, coverage }) {
  return {
    exame: { data: exam.date, animal_cadastro: animal.tag },
    cobertura: coverage.map((c) => ({ tipo: c.kind, duracao_s: c.duration_s, quadros_analisados: c.frames, instantes_s: c.times_s })),
    achados_visuais: visual.structures.map((s) => ({
      estrutura: s.identification, status: s.identification_status, quadros: s.frames, evidencia: s.evidence,
      estado: s.state, alteracoes: s.suspected_changes.map((c) => c.observed)
    })),
    gestacao: derived.gestation_status,
    nao_avaliado: visual.not_evaluated.map((n) => `${n.structure}: ${n.reason}`),
    medidas_da_tela: Object.values(derived.measurements).filter(Boolean).map((m) => `${m.label} ${m.value}`),
    pontos_de_conferencia: cross.checks.filter((c) => c.severity !== "info").map((c) => c.message)
  };
}

function templateNarrative(facts) {
  const cov = facts.cobertura.map((c) => (c.tipo === "vídeo" ? `${c.quadros_analisados} quadros de um vídeo de ${c.duracao_s} s` : "uma imagem")).join(" e ");
  const lines = [`Rascunho do exame de ${facts.exame.data}, analisado em ${cov}.`];
  const seen = facts.achados_visuais.filter((a) => a.status !== "não identificado com segurança");
  lines.push(seen.length ? `Achados visuais: ${seen.map((a) => `${a.estrutura} (${a.status}, quadros ${a.quadros.join(", ") || "sem referência"}; ${a.estado})`).join("; ")}.` : "Nenhuma estrutura identificada com segurança nos quadros analisados.");
  lines.push(`Gestação: ${facts.gestacao}.`);
  if (facts.nao_avaliado.length) lines.push(`Não avaliável neste clipe: ${facts.nao_avaliado.join("; ")}.`);
  if (facts.pontos_de_conferencia.length) lines.push(`Para conferência: ${facts.pontos_de_conferencia.join(" ")}`);
  lines.push("Rascunho gerado por agentes de IA, com identificações experimentais; sem validade clínica até a aprovação do médico-veterinário responsável.");
  return lines.join(" ");
}

const NUM = /\d+(?:[.,]\d+)?/g;

/** Todo número da narrativa precisa aparecer nos fatos (datas contam pelos seus números). */
function factNumbers(value, out = new Set()) {
  if (typeof value === "number") out.add(String(value));
  else if (typeof value === "string") (value.match(NUM) || []).forEach((n) => out.add(n.replace(",", ".")));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => factNumbers(v, out));
  return out;
}

function verifyNarrative(narrative, facts) {
  // Cada valor é lido separado: num JSON, "[1,2]" viraria o decimal 1,2.
  const allowed = factNumbers(facts);
  const unknown = (narrative.match(NUM) || []).map((n) => n.replace(",", ".")).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
  const forbidden = /\b(recomend|prescrev|tratar com|administrar|aplicar \d|dose de|diagnóstico definitivo)/i.test(narrative);
  return { ok: unknown.length === 0 && !forbidden, unknownNumbers: [...new Set(unknown)], forbiddenTerms: forbidden };
}

const WRITER_INSTRUCTIONS = [
  "Você redige o rascunho de um laudo de ultrassonografia de bovino, em português, em até 6 frases.",
  "Use somente os fatos do JSON. Comece pelos achados visuais citando os quadros; diga quantos quadros foram analisados (é amostragem, não o vídeo inteiro); depois o que não foi avaliável; depois os pontos de conferência, se houver.",
  "Identificações com status 'hipótese' ou 'não identificado com segurança' devem aparecer como tal. Ausência de estrutura num clipe não é resultado negativo.",
  "Não acrescente número, medida, lateralidade, causa, diagnóstico definitivo, prognóstico, tratamento ou recomendação. Datas no formato DD/MM/AAAA. Não copie nomes de campos.",
  "Termine dizendo que o rascunho só vale após aprovação do médico-veterinário."
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

module.exports = { buildFacts, templateNarrative, verifyNarrative, writeNarrative };
