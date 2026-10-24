"use strict";

/**
 * Leitor SIMULADO, só para demonstração sem chave do Gemini. Devolve sempre a
 * mesma leitura fictícia; a resposta da API e a tela marcam "simulado", para
 * nunca ser confundido com uma leitura real.
 */
const SIMULATED_READING = {
  screen_text: { animal_id: null, exam_date: null, equipment: "Aparelho de demonstração", measurements: [{ label: "CL", value: 24, unit: "mm" }, { label: "IG", value: 45, unit: "dias" }] },
  findings: {
    pregnancy: { value: "prenhe", confidence: 0.82, evidence: "(simulado) vesícula embrionária visível", source: "observacao_visual" },
    gestational_age_days: { value: 45, confidence: 0.9, evidence: "(simulado) medida IG 45 dias na tela", source: "medida_na_tela" },
    corpus_luteum_mm: { value: 24, confidence: 0.88, evidence: "(simulado) medida CL 24 mm na tela", source: "medida_na_tela" },
    follicle_largest_mm: { value: null, confidence: 0, evidence: "", source: "nao_visivel" },
    uterine_horn: { value: "direito", confidence: 0.7, evidence: "(simulado) gestação no corno direito", source: "observacao_visual" },
    fluid_presence: { value: "sim", confidence: 0.75, evidence: "(simulado) líquido anecoico", source: "observacao_visual" },
    fetal_heartbeat: { value: null, confidence: 0, evidence: "", source: "nao_visivel" }
  },
  image_quality: { usable: true, issues: [] }
};

function simulatedClient() {
  return {
    model: "simulado",
    async generate() {
      return { text: JSON.stringify(SIMULATED_READING), usage: { inputTokens: 0, outputTokens: 0, ms: 0 } };
    }
  };
}

module.exports = { simulatedClient, SIMULATED_READING };
