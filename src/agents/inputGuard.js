"use strict";
const crypto = require("node:crypto");

/**
 * Guarda de entrada (determinística). Recusa antes de gastar IA: tipo de
 * arquivo fora da lista, arquivo grande demais, nenhum animal ou data do exame.
 * Devolve o hash de cada mídia para a proveniência do prontuário.
 */
function checkInput(request, config) {
  const problems = [];
  const media = Array.isArray(request.media) ? request.media : [];
  if (!request.animal?.id || !request.animal?.tag) problems.push("Informe o animal do exame (id e brinco).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(request.exam?.date || ""))) problems.push("Informe a data do exame no formato AAAA-MM-DD.");
  if (!media.length) problems.push("Envie ao menos uma imagem ou vídeo do ultrassom.");
  if (media.length > config.media.maxFiles) problems.push(`Envie no máximo ${config.media.maxFiles} arquivos por exame.`);
  let total = 0;
  const accepted = [];
  media.forEach((item, i) => {
    const size = item.buffer ? item.buffer.length : 0;
    total += size;
    if (!config.media.allowedMimeTypes.includes(item.mimeType)) problems.push(`Arquivo ${i + 1}: tipo ${item.mimeType || "desconhecido"} não aceito (use JPEG, PNG, MP4, MOV ou AVI).`);
    else if (!size) problems.push(`Arquivo ${i + 1}: vazio.`);
    else if (size > config.media.maxBytesPerFile) problems.push(`Arquivo ${i + 1}: maior que ${Math.round(config.media.maxBytesPerFile / 1048576)} MB.`);
    else accepted.push({ index: i, mimeType: item.mimeType, bytes: size, sha256: crypto.createHash("sha256").update(item.buffer).digest("hex") });
  });
  if (total > config.media.maxTotalBytes) problems.push(`O total dos arquivos passa de ${Math.round(config.media.maxTotalBytes / 1048576)} MB.`);
  return { ok: problems.length === 0, problems, media: accepted };
}

module.exports = { checkInput };
