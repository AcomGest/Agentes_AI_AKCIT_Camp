"use strict";
/**
 * Preparação da mídia para os leitores (sem dependência de rede).
 *
 * Vídeo: N quadros distribuídos ao longo do clipe, cada um com o instante
 * (s). Imagem: o próprio arquivo, como quadro único.
 * Para cada quadro produz:
 *   - full: quadro inteiro (com as bordas e textos do aparelho) → Leitor de tela
 *   - roi:  só a região ultrassonográfica, recortada → Leitor visual
 *   - thumb: miniatura da região, para o laudo mostrar o quadro de cada achado
 * O recorte vem do `cropdetect` do ffmpeg somado ao maior bloco escuro, e é o
 * mesmo para todos os quadros do clipe (a sonda não muda o enquadramento).
 */
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require("ffmpeg-static"); if (p && fs.existsSync(p)) return p; } catch { /* sem pacote */ }
  return "ffmpeg";
}

const run = (args, timeoutMs = 60000) => new Promise((resolve, reject) => {
  execFile(ffmpegPath(), ["-hide_banner", "-loglevel", "info", ...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }, (error, stdout, stderr) => {
    const log = Buffer.from(stderr || "").toString("utf8");
    if (error && !log.includes("Duration")) return reject(Object.assign(new Error(`ffmpeg falhou: ${log.split("\n").slice(-3).join(" ").trim() || error.message}`), { log }));
    resolve({ stdout, log });
  });
});

function parseDuration(log) {
  const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Maior sequência contínua de posições acima do limiar. */
function longestRun(values, threshold) {
  let best = [0, -1], start = -1;
  values.forEach((v, i) => {
    if (v >= threshold) { if (start < 0) start = i; if (i - start > best[1] - best[0]) best = [start, i]; }
    else start = -1;
  });
  return best[1] >= best[0] ? best : null;
}

/**
 * Região ultrassonográfica: a imagem do exame é o bloco grande de textura
 * (pixels não pretos densos); bordas têm fundo preto com textos esparsos e
 * faixas de cabeçalho. Escolhe as colunas densas e, dentro delas, a maior
 * sequência de linhas densas (descarta o cabeçalho, que fica separado por
 * uma faixa preta).
 */
async function detectRoi(fullJpeg, dir) {
  const src = path.join(dir, "roi-src.jpg");
  fs.writeFileSync(src, fullJpeg);
  const probe = await run(["-i", src, "-f", "null", "-"]);
  const size = probe.log.match(/, (\d{2,5})x(\d{2,5})/);
  if (!size) return null;
  const [W, H] = [Number(size[1]), Number(size[2])];
  const w = 200, h = Math.max(2, Math.round((200 * H) / W));
  const { stdout } = await run(["-i", src, "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"]);
  const px = Buffer.from(stdout);
  if (px.length < w * h) return null;
  const on = (x, y) => px[y * w + x] > 10;
  const colDensity = Array.from({ length: w }, (_, x) => { let n = 0; for (let y = 0; y < h; y++) n += on(x, y); return n / h; });
  const cols = longestRun(colDensity, 0.5);
  if (!cols) return null;
  const rowDensity = Array.from({ length: h }, (_, y) => { let n = 0; for (let x = cols[0]; x <= cols[1]; x++) n += on(x, y); return n / (cols[1] - cols[0] + 1); });
  const rows = longestRun(rowDensity, 0.3);
  if (!rows) return null;
  const sx = W / w, sy = H / h;
  const roi = { x: Math.floor(cols[0] * sx), y: Math.floor(rows[0] * sy), w: Math.ceil((cols[1] - cols[0] + 1) * sx), h: Math.ceil((rows[1] - rows[0] + 1) * sy) };
  // Região pequena demais não é a imagem do exame: sem recorte (o leitor visual é avisado).
  return roi.w * roi.h >= 0.12 * W * H ? { ...roi, frame_w: W, frame_h: H } : null;
}

async function grabFull(file, t, dir, i) {
  const full = path.join(dir, `f${i}.jpg`);
  await run([...(t != null ? ["-ss", String(t)] : []), "-i", file, "-frames:v", "1", "-q:v", "2", "-y", full]);
  return fs.readFileSync(full);
}

async function cropOne(fullBuffer, t, roi, dir, i) {
  const full = path.join(dir, `f${i}.jpg`), crop = path.join(dir, `r${i}.jpg`), thumb = path.join(dir, `t${i}.jpg`);
  fs.writeFileSync(full, fullBuffer);
  const cropFilter = roi ? `crop=${roi.w}:${roi.h}:${roi.x}:${roi.y}` : "null";
  await run(["-i", full, "-vf", cropFilter, "-q:v", "2", "-y", crop]);
  await run(["-i", crop, "-vf", "scale=360:-2", "-q:v", "5", "-y", thumb]);
  return { index: i + 1, time_s: t != null ? Math.round(t * 10) / 10 : null, full: fs.readFileSync(full), roi: fs.readFileSync(crop), thumb: fs.readFileSync(thumb) };
}

/**
 * @returns {{ frames, coverage, roi }} — coverage diz exatamente o que foi analisado.
 */
async function prepareFrames(mediaList, { framesPerVideo = 8 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acg-us-frames-"));
  const frames = [];
  const coverage = [];
  let roiInfo = null;
  try {
    for (const [m, item] of mediaList.entries()) {
      const isVideo = item.mimeType.startsWith("video/");
      const file = path.join(dir, `in${m}${isVideo ? ".avi" : ".img"}`);
      fs.writeFileSync(file, item.buffer);
      const probe = await run(["-i", file, "-f", "null", "-frames:v", "1", "-"]);
      const duration = isVideo ? parseDuration(probe.log) : null;
      const times = isVideo && duration ? Array.from({ length: framesPerVideo }, (_, i) => ((i + 0.5) * duration) / framesPerVideo) : [null];
      const start = frames.length;
      const fulls = [];
      for (const [i, t] of times.entries()) fulls.push(await grabFull(file, t, dir, start + i));
      // Mesmo recorte para o clipe todo, detectado no quadro do meio.
      const roi = await detectRoi(fulls[Math.floor(fulls.length / 2)], dir);
      roiInfo = roiInfo || roi;
      for (const [i, t] of times.entries()) frames.push({ media: m + 1, ...(await cropOne(fulls[i], t, roi, dir, start + i)) });
      coverage.push({ media: m + 1, kind: isVideo ? "vídeo" : "imagem", duration_s: duration != null ? Math.round(duration * 10) / 10 : null, frames: times.length, times_s: times.map((t) => (t != null ? Math.round(t * 10) / 10 : null)), roi });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { frames, coverage, roi: roiInfo };
}

module.exports = { prepareFrames, ffmpegPath };
