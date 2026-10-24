"use strict";
const { VLM_SCHEMA, validate, normalizeFindings } = require("../schema");
const { mediaPart } = require("../gemini");

/**
 * Agente Leitor (VLM). Lê imagens e vídeos exportados do aparelho e devolve
 * achados estruturados com confiança e evidência. Regras do prompt:
 * número só quando aparece medido na tela; o que não está visível vem nulo;
 * nenhuma conclusão clínica fora dos campos do contrato.
 */
const INSTRUCTIONS = [
  "Você auxilia um médico-veterinário a registrar um exame de ultrassonografia reprodutiva em bovinos.",
  "Analise as imagens e vídeos exportados do aparelho e preencha o JSON do contrato.",
  "Regras:",
  "1. Leia primeiro o texto da tela (identificação do animal, data, aparelho, medidas com unidade).",
  "2. Medidas numéricas (mm, dias) só podem vir de uma medida escrita na tela: use source=medida_na_tela. Nunca estime um número a olho.",
  "3. Prenhez, corno uterino, líquido e batimento podem vir de observação visual (source=observacao_visual), com confiança honesta entre 0 e 1.",
  "4. O que não estiver visível ou legível fica nulo, com source=nao_visivel e confiança 0.",
  "5. Em evidence, descreva em uma frase curta o que na imagem sustenta o valor (ex.: 'medida CL 24 mm na tela', 'vesícula embrionária visível no corno direito').",
  "6. Marque image_quality.usable=false se a imagem estiver ilegível, cortada ou sem estruturas reprodutivas, e liste os problemas.",
  "7. Não escreva diagnóstico, prognóstico, tratamento ou recomendação. O veterinário decide."
].join("\n");

async function readMedia({ client, media, exam, attempts = 2, onStep = () => {} }) {
  const parts = media.map((m) => mediaPart(m.buffer, m.mimeType));
  parts.push({ text: `Data informada do exame: ${exam.date}. Aparelho informado: ${exam.equipment || "não informado"}.` });
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
