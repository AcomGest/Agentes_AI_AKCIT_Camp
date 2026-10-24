#!/usr/bin/env node
"use strict";
/**
 * Avaliação do Leitor com exames reais rotulados por médico-veterinário.
 *
 *   GEMINI_API_KEY=... GEMINI_MODEL=... node agents/ultrasound-agent/eval/run-eval.js <pasta>
 *
 * A pasta tem os arquivos dos exames e um labels.json:
 *   [{ "file": "exame01.mp4", "animal": "1042", "date": "2026-10-20",
 *      "expected": { "pregnancy": "prenhe", "gestational_age_days": 45, "corpus_luteum_mm": 24 } }]
 *
 * Mede, por campo: acerto (valor igual; números com tolerância), cobertura
 * (o Leitor respondeu algo) e "número inventado" (respondeu número quando o
 * rótulo diz que não havia). Também mede latência e tokens. Nenhum exame real
 * acompanha o repositório: os rótulos precisam vir do veterinário parceiro.
 */
const fs = require("node:fs");
const path = require("node:path");
const { runUltrasoundAgent } = require("../src/harness");
const { createGeminiClient } = require("../src/gemini");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".mov": "video/quicktime" };
const TOLERANCE = { gestational_age_days: 5, corpus_luteum_mm: 2, follicle_largest_mm: 2 };

(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error("Uso: node run-eval.js <pasta com labels.json>"); process.exit(2); }
  const labels = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"));
  const client = createGeminiClient({ apiKey: String(process.env.GEMINI_API_KEY || "").trim(), model: process.env.GEMINI_MODEL || "" });
  const stats = {};
  const runs = [];
  for (const label of labels) {
    const file = path.join(dir, label.file);
    const started = Date.now();
    const result = await runUltrasoundAgent({
      animal: { id: label.animal, tag: label.animal }, exam: { date: label.date },
      media: [{ mimeType: MIME[path.extname(file).toLowerCase()], buffer: fs.readFileSync(file) }],
      history: label.history || {}
    }, { vlmClient: client });
    runs.push({ file: label.file, status: result.status, ms: Date.now() - started, tokens: result.trace.usage });
    if (!result.reading) continue;
    for (const [field, expected] of Object.entries(label.expected)) {
      const s = (stats[field] ||= { total: 0, correct: 0, answered: 0, invented: 0 });
      const got = result.reading.findings[field]?.value ?? null;
      s.total++;
      if (got !== null) s.answered++;
      if (expected === null && typeof got === "number") s.invented++;
      const ok = typeof expected === "number" && typeof got === "number" ? Math.abs(expected - got) <= (TOLERANCE[field] ?? 0) : expected === got;
      if (ok) s.correct++;
    }
  }
  console.log("Campo | acerto | cobertura | número inventado");
  for (const [field, s] of Object.entries(stats)) console.log(`${field} | ${s.correct}/${s.total} | ${s.answered}/${s.total} | ${s.invented}`);
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\nExames: ${runs.length} · falhas: ${runs.filter((r) => r.status !== "rascunho_aguardando_veterinario").length} · latência mediana: ${ms[Math.floor(ms.length / 2)] || 0} ms`);
  fs.writeFileSync(path.join(dir, `resultado-${Date.now()}.json`), JSON.stringify({ stats, runs }, null, 2));
})().catch((error) => { console.error(`Falha: ${error.message}`); process.exitCode = 1; });
