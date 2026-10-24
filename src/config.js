"use strict";

/**
 * Parâmetros do agente. As faixas clínicas são valores iniciais para bovinos,
 * configuráveis por fazenda, e precisam ser validadas por médico-veterinário
 * antes do uso em produção: o agente só as usa para levantar alertas de
 * conferência, nunca para concluir um diagnóstico.
 */
const DEFAULT_CONFIG = {
  promptVersion: "ultrassom-leitor-v2",
  media: {
    // AVI é o formato que muitos aparelhos de ultrassom exportam.
    allowedMimeTypes: ["image/jpeg", "image/png", "video/mp4", "video/quicktime", "video/avi", "video/x-msvideo"],
    maxFiles: 4,
    // Envio direto ao Gemini (inlineData) aceita até 20 MB por pedido, já em base64.
    maxBytesPerFile: 14 * 1024 * 1024,
    maxTotalBytes: 14 * 1024 * 1024
  },
  // Abaixo disso o campo vai para o rascunho marcado "conferir".
  minConfidence: 0.6,
  // Tolerância entre a idade gestacional lida e os dias desde o serviço registrado.
  gestationalToleranceDays: 10,
  ranges: {
    gestational_age_days: { min: 25, max: 290, unit: "dias" },
    corpus_luteum_mm: { min: 10, max: 40, unit: "mm" },
    follicle_largest_mm: { min: 2, max: 25, unit: "mm" }
  },
  // Janela para "prenhe sem serviço registrado".
  serviceLookbackDays: 300,
  // Janela para comparar com um exame anterior positivo.
  previousPositiveWindowDays: 90,
  maxVlmAttempts: 2,
  maxSteps: 8
};

module.exports = { DEFAULT_CONFIG };
