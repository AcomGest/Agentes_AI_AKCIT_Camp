"use strict";

/**
 * Leitores SIMULADOS, só para demonstração e testes sem chave do Gemini.
 * Respondem pelo contrato pedido (tela ou visual); a resposta da API e a tela
 * marcam "simulado", para nunca ser confundido com uma leitura real. Os
 * quadros simulados não substituem a extração: a extração de quadros continua
 * real (ou é trocada no teste).
 */
const SIMULATED_SCREEN = {
  texts: [{ text: "(simulado) Paciente X", position: "direita", likely_role: "identificação do paciente" }, { text: "(simulado) 20/10/2026", position: "topo", likely_role: "data/hora" }],
  exam_date: "2026-10-20", exam_time: null, equipment: "Aparelho de demonstração", transducer: null, frequency_mhz: null, depth_cm: null,
  measurements: [{ label: "IG", value: 45, unit: "d" }, { label: "CL", value: 24, unit: "mm" }]
};

const SIMULATED_VISUAL = {
  image_quality: { usable: true, issues: [] },
  structures: [
    { id: "E1", identification: "vesícula gestacional", identification_status: "identificado", frames: [1, 2], location_in_frame: "centro", evidence: "(simulado) área anecoica arredondada com estrutura ecogênica interna", shape: "arredondada", contours: "regulares", echogenicity: "anecoica", echotexture: "homogênea", content: "líquido", internal_features: "(simulado) estrutura ecogênica interna", parent_id: null, relations: "(simulado) no lúmen uterino", possible_artifact: false, state: "compatível com o esperado no que foi visualizado", state_basis: "(simulado) contornos regulares", suspected_changes: [], limitations: "(simulado) viabilidade não avaliável em quadros" },
    { id: "E2", identification: "corpo lúteo", identification_status: "hipótese", frames: [2], location_in_frame: "superior direito", evidence: "(simulado) estrutura ecogênica arredondada", shape: "arredondada", contours: "bem definidos", echogenicity: "hipoecoica", echotexture: "homogênea", content: "sólido", internal_features: "", parent_id: null, relations: "", possible_artifact: false, state: "inconclusiva", state_basis: "(simulado) ovário não delimitado", suspected_changes: [], limitations: "" }
  ],
  not_evaluated: [{ structure: "ovário contralateral", reason: "(simulado) não incluído no clipe" }],
  gestation: { status: "estruturas gestacionais identificadas", frames: [1, 2], basis: "(simulado) vesícula com estrutura interna" },
  preliminary_interpretation: { text: "(simulado) Achados compatíveis com gestação inicial, a confirmar pelo veterinário.", basis: "(simulado) vesícula gestacional nos quadros 1 e 2" }
};

/** Quadros falsos para testes/demonstração sem ffmpeg. */
async function simulatedFrames(media) {
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  const frames = [1, 2].map((index) => ({ index, media: 1, time_s: index === 1 ? 0.5 : 1.5, full: jpeg, roi: jpeg, thumb: jpeg }));
  return { frames, coverage: [{ media: 1, kind: media[0]?.mimeType?.startsWith("image/") ? "imagem" : "vídeo", duration_s: 2, frames: 2, times_s: [0.5, 1.5], roi: null }], roi: null };
}

function simulatedClient() {
  return {
    model: "simulado",
    async generate({ schema }) {
      const visual = Boolean(schema?.properties?.structures);
      return { text: JSON.stringify(visual ? SIMULATED_VISUAL : SIMULATED_SCREEN), usage: { inputTokens: 0, outputTokens: 0, ms: 0 } };
    }
  };
}

module.exports = { simulatedClient, simulatedFrames, SIMULATED_SCREEN, SIMULATED_VISUAL };
