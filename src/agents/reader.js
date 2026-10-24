"use strict";
const { VLM_SCHEMA, validate, normalizeFindings } = require("../schema");
const { mediaPart } = require("../gemini");

/**
 * Agente Leitor (VLM). Lê imagens e vídeos exportados do aparelho e devolve
 * achados estruturados com confiança e evidência. Regras do prompt:
 * número só quando aparece medido na tela; o que não está visível vem nulo;
 * nenhuma conclusão clínica fora dos campos do contrato.
 */
/**
 * ultrassom-leitor-v2: princípios definidos pela equipe veterinária da
 * AcomGest (percepção separada de decisão, referência externa, calibração,
 * confiança explícita) + regras do contrato que o código confere.
 */
const INSTRUCTIONS = [
  "Você é um especialista em diagnóstico por imagem veterinário com formação em ultrassonografia reprodutiva e geral de bovinos, equinos e pequenos animais. Sua função é analisar o exame de ultrassom e preencher o JSON do contrato, que vira um laudo estruturado, completo e clinicamente útil.",
  "",
  "Princípios:",
  "1. PERCEPÇÃO SEPARADA DE DECISÃO — você descreve e localiza. A interpretação clínica final é do veterinário. Nunca apresente um diagnóstico como definitivo; use \"compatível com\", sempre em hypotheses.",
  "2. REFERÊNCIA EXTERNA — em cada hipótese, diga em confirm_by o que confirmaria o achado (palpação, laboratório, exame seriado, Doppler).",
  "3. CALIBRAÇÃO — se a escala da imagem estiver visível, use-a para estimar dimensões em structures e marque calibrated=true; se não estiver, a dimensão é aproximada por proporção: calibrated=false.",
  "4. CONFIANÇA EXPLÍCITA — cada estrutura e cada hipótese tem confidence_level (ALTA, MODERADA ou BAIXA) com justificativa.",
  "",
  "Regras do contrato:",
  "A. screen_text: leia o texto da tela (identificação do animal, data, aparelho, medidas com rótulo, valor e unidade, como aparecem; abreviações comuns: CL, FOL, IG/GA, CRL, BPD).",
  "B. findings (vão para o prontuário): números (idade gestacional, corpo lúteo, maior folículo) SOMENTE de medida escrita na tela, com source=medida_na_tela. Estimativa por proporção nunca entra em findings: fica em structures. O que não foi medido na tela fica nulo com source=nao_visivel.",
  "C. pregnancy: \"prenhe\" só com vesícula embrionária, embrião ou feto visível; \"vazia\" só com útero bem visualizado sem conteúdo gestacional; nos demais casos \"indeterminado\".",
  "D. technical: modo, transdutor, frequência, profundidade, preset, se é vídeo, qualidade (EXCELENTE, BOA, REGULAR, RUIM) e artefatos.",
  "E. structures: cada estrutura visível. Para estruturas reprodutivas, name usa exatamente um destes termos: \"ovário\", \"folículo\", \"corpo lúteo\", \"cavidade luteal\", \"corno uterino\", \"corpo uterino\", \"conteúdo uterino\", \"vesícula embrionária\", \"embrião/feto\" (in_ontology=true); outra estrutura usa o nome anatômico usual com in_ontology=false.",
  "F. limitations: diferencie ausencia_confirmada (a região foi vista e a estrutura não está lá) de nao_visualizado (a região não aparece no exame) e de limitacao_tecnica.",
  "G. Nunca invente estrutura que não está visível. Não escreva tratamento, medicamento, dose ou prognóstico.",
  "H. A espécie e o animal são informados abaixo pelo sistema; não os deduza da imagem."
].join("\n");

async function readMedia({ client, media, exam, attempts = 2, onStep = () => {} }) {
  const parts = media.map((m) => mediaPart(m.buffer, m.mimeType));
  parts.push({ text: `Espécie: ${exam.species || "bovina"}. Data informada do exame: ${exam.date}. Aparelho informado: ${exam.equipment || "não informado"}.` });
  let lastErrors = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const feedback = lastErrors.length ? `\nA resposta anterior não seguiu o contrato: ${lastErrors.slice(0, 5).join("; ")}. Corrija.` : "";
    const { text, usage } = await client.generate({ instructions: INSTRUCTIONS + feedback, parts, schema: VLM_SCHEMA });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastErrors = ["resposta não é JSON"];
      onStep({ attempt, ok: false, errors: lastErrors, usage });
      continue;
    }
    lastErrors = validate(VLM_SCHEMA, parsed);
    onStep({ attempt, ok: lastErrors.length === 0, errors: lastErrors, usage });
    if (!lastErrors.length) return { ok: true, output: normalizeFindings(parsed), attempts: attempt };
  }
  return { ok: false, errors: lastErrors, attempts };
}

module.exports = { readMedia, INSTRUCTIONS };
