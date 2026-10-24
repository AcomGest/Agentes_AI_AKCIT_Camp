"use strict";
const { SCREEN_SCHEMA, VISUAL_SCHEMA, validate, normalizeVisual } = require("../schema");

/**
 * Dois leitores, com entradas separadas de propósito:
 *
 * Leitor de tela (ultrassom-tela-v1): recebe o quadro inteiro e transcreve o
 *   texto do aparelho. Não interpreta a imagem e não decide o que um texto
 *   significa.
 * Leitor visual (ultrassom-visual-v3): recebe só a região ultrassonográfica
 *   recortada de cada quadro, numerada e com o instante. Não recebe cadastro,
 *   histórico nem texto da tela, para que nome, brinco ou histórico não mudem
 *   o que ele descreve. Princípios definidos pela equipe veterinária.
 */
const SCREEN_INSTRUCTIONS = [
  "Você transcreve o texto escrito na tela de um aparelho de ultrassom veterinário.",
  "Liste cada texto visível como aparece, com a posição na tela e o papel provável (likely_role).",
  "Um nome ou código na área do paciente é 'identificação do paciente', mas você não sabe se é o nome do animal, do proprietário ou outro campo: apenas transcreva.",
  "Preencha data, hora, aparelho, transdutor, frequência (MHz) e profundidade (cm) só quando estiverem escritos. Medidas só se houver uma medição feita na tela (rótulo, valor e unidade); números de escala não são medidas.",
  "Não descreva a imagem ultrassonográfica."
].join("\n");

const VISUAL_INSTRUCTIONS = [
  "Você é um especialista em diagnóstico por imagem veterinário com formação em ultrassonografia reprodutiva de bovinos. Você recebe quadros recortados de um exame (só a região da imagem), numerados e com o instante no clipe. Não há texto, cadastro nem histórico: descreva apenas o que as imagens mostram.",
  "",
  "Princípios:",
  "1. PERCEPÇÃO SEPARADA DE DECISÃO — descreva e localize. A interpretação final é do veterinário. Nunca apresente diagnóstico como definitivo.",
  "2. REFERÊNCIA EXTERNA — em cada alteração suspeita, diga em confirm_by como confirmar (palpação, laboratório, exame seriado, Doppler).",
  "3. SEM INVENÇÃO — não informe lateralidade, medidas, contagens, batimentos ou percentuais. Não há escala verificada nestes quadros.",
  "4. EVIDÊNCIA — toda estrutura cita os números dos quadros (frames) em que aparece e o que nela sustenta a identificação (evidence).",
  "",
  "Para cada estrutura:",
  "- identification: o que parece ser. Estruturas reprodutivas usam exatamente: ovário, folículo, corpo lúteo, cavidade luteal, corno uterino, corpo uterino, conteúdo uterino, vesícula gestacional, embrião/feto.",
  "- identification_status: 'identificado' só com evidência clara; 'hipótese' quando plausível mas não confirmado; 'não identificado com segurança' quando incerto. Não classifique toda área escura como folículo ou vesícula.",
  "- características: forma, contornos, ecogenicidade, ecotextura, conteúdo (sólido, líquido, misto), paredes, cavidades, septações, conteúdo interno, relação com estruturas vizinhas (parent_id: folículo dentro do ovário, cavidade dentro do corpo lúteo).",
  "- possible_artifact: true se pode ser artefato (sombra, reforço, reverberação).",
  "- state: 'compatível com o esperado no que foi visualizado', 'alteração morfológica suspeita' (diga exatamente qual em suspected_changes: observado, significado possível, hipótese patológica só se sustentada, diferenciais, como confirmar) ou 'inconclusiva' (explique em state_basis). Não declare normal só porque nada foi detectado; não atribua função hormonal, fase do ciclo ou viabilidade só pela aparência.",
  "- A mesma estrutura vista em quadros sucessivos é UMA estrutura com vários frames, não várias.",
  "",
  "not_evaluated: o que não pode ser avaliado neste clipe e por quê (ex.: útero não incluído). Ausência num trecho não é diagnóstico negativo: use 'não avaliável neste clipe' ou 'não identificado com segurança'.",
  "gestation.status: 'estruturas gestacionais identificadas' só com vesícula ou embrião visível nos quadros citados; 'não demonstrada neste clipe' quando o útero não aparece ou não há estrutura gestacional nos quadros; 'inconclusiva' quando houver dúvida. Não force a análise para gestação: um clipe ovariano deve ser descrito como ovariano.",
  "preliminary_interpretation: 2 a 4 frases do que os achados sugerem, separando descrição de interpretação, sem diagnóstico definitivo, tratamento ou dose."
].join("\n");

async function callWithContract({ client, instructions, parts, schema, attempts, onStep, stepName }) {
  let lastErrors = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const feedback = lastErrors.length ? `\nA resposta anterior não seguiu o contrato: ${lastErrors.slice(0, 5).join("; ")}. Corrija.` : "";
    const { text, usage } = await client.generate({ instructions: instructions + feedback, parts, schema });
    let parsed;
    try { parsed = JSON.parse(text); } catch { lastErrors = ["resposta não é JSON"]; onStep(stepName, { attempt, ok: false, errors: lastErrors, usage }); continue; }
    lastErrors = validate(schema, parsed);
    onStep(stepName, { attempt, ok: lastErrors.length === 0, errors: lastErrors, usage });
    if (!lastErrors.length) return { ok: true, output: parsed };
  }
  return { ok: false, errors: lastErrors };
}

const imagePart = (buffer) => ({ inlineData: { mimeType: "image/jpeg", data: Buffer.from(buffer).toString("base64") } });

/** Texto da tela: o quadro inteiro do meio do primeiro arquivo (e o primeiro de cada arquivo seguinte). */
async function readScreen({ client, frames, attempts = 2, onStep = () => {} }) {
  const picks = [];
  const byMedia = new Map();
  for (const f of frames) { if (!byMedia.has(f.media)) byMedia.set(f.media, []); byMedia.get(f.media).push(f); }
  for (const list of byMedia.values()) picks.push(list[Math.floor(list.length / 2)]);
  const parts = picks.flatMap((f) => [{ text: `Quadro inteiro ${f.index}${f.time_s != null ? ` (t=${f.time_s} s)` : ""}:` }, imagePart(f.full)]);
  return callWithContract({ client, instructions: SCREEN_INSTRUCTIONS, parts, schema: SCREEN_SCHEMA, attempts, onStep, stepName: "leitor_de_tela" });
}

/** Achados visuais: só as regiões recortadas, numeradas, sem nenhum contexto. */
async function readVisual({ client, frames, species = "bovina", attempts = 2, onStep = () => {} }) {
  // Sem recorte (região da imagem não encontrada), o quadro inteiro vai junto
  // com o texto da tela: o leitor é avisado para não usá-lo como achado.
  const uncropped = frames.some((f) => f.cropped === false);
  const parts = [{ text: `Espécie: ${species}. ${frames.length} quadros do exame${uncropped ? ". A região da imagem não foi isolada em alguns quadros: ignore textos, números e marcações das bordas e descreva só a imagem ultrassonográfica." : " recortados."}` }];
  for (const f of frames) parts.push({ text: `Quadro ${f.index}${f.time_s != null ? ` · t=${f.time_s} s` : ""}:` }, imagePart(f.roi));
  const result = await callWithContract({ client, instructions: VISUAL_INSTRUCTIONS, parts, schema: VISUAL_SCHEMA, attempts, onStep, stepName: "leitor_visual" });
  return result.ok ? { ok: true, output: normalizeVisual(result.output, frames.length) } : result;
}

module.exports = { readScreen, readVisual, SCREEN_INSTRUCTIONS, VISUAL_INSTRUCTIONS };
