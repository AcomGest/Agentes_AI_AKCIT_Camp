#!/usr/bin/env node
"use strict";
/**
 * Avaliação dos Leitores com exames reais rotulados por médico-veterinário.
 *
 *   GEMINI_API_KEY=... GEMINI_MODEL=... node agents/ultrasound-agent/eval/run-eval.js <pasta>
 *
 * A pasta tem os arquivos dos exames e um labels.json:
 *   [{ "file": "exame01.avi", "animal": "1042", "date": "2026-10-20",
 *      "expected": { "gestation": "vazia", "gestational_age_days": null, "corpus_luteum_mm": null,
 *                    "structures": ["ovário", "corpo lúteo", "folículo"] } }]
 *
 * gestation: "prenhe" (estruturas gestacionais identificadas), "vazia" (não
 * demonstrada neste clipe) ou null (inconclusiva). Medidas vêm do rascunho,
 * que só usa medidas feitas na tela. structures: o que o veterinário vê no
 * clipe; o avaliador conta as estruturas que o Leitor visual deu como
 * "identificado" e as que ele identificou a mais.
 *
 * Mede, por campo: acerto (números com tolerância), cobertura (o agente
 * respondeu algo) e "número inventado" (número onde o rótulo diz que não
 * havia). Também mede latência e tokens. Nenhum exame real acompanha o
 * repositório: os rótulos precisam vir do veterinário parceiro.
 */
const fs = require("node:fs");
const path = require("node:path");
const { runUltrasoundAgent } = require("../src/harness");
const { createGeminiClient } = require("../src/gemini");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/avi" };
const TOLERANCE = { gestational_age_days: 5, corpus_luteum_mm: 2, follicle_largest_mm: 2 };
const GESTATION = { "estruturas gestacionais identificadas": "prenhe", "não demonstrada neste clipe": "vazia", inconclusiva: null };

function answers(result) {
  return {
    gestation: GESTATION[result.visual.gestation.status] ?? null,
    gestational_age_days: result.draft.gestational_age_days,
    corpus_luteum_mm: result.draft.corpus_luteum_mm,
    follicle_largest_mm: result.draft.diameter_mm
  };
}

(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error("Uso: node run-eval.js <pasta com labels.json>"); process.exit(2); }
  const labels = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"));
  const client = createGeminiClient({ apiKey: String(process.env.GEMINI_API_KEY || "").trim(), model: process.env.GEMINI_MODEL || "" });
  const stats = {};
  const structures = { expected: 0, identified: 0, extra: 0 };
  const runs = [];
  for (const label of labels) {
    const file = path.join(dir, label.file);
    const started = Date.now();
    const result = await runUltrasoundAgent({
      animal: { id: label.animal, tag: label.animal }, exam: { date: label.date, species: "bovina" },
      media: [{ mimeType: MIME[path.extname(file).toLowerCase()], buffer: fs.readFileSync(file) }],
      history: label.history || {}
    }, { vlmClient: client });
    runs.push({ file: label.file, status: result.status, ms: Date.now() - started, tokens: result.trace.usage });
    if (result.status !== "rascunho_aguardando_veterinario") continue;
    const got = answers(result);
    for (const [field, expected] of Object.entries(label.expected)) {
      if (field === "structures") continue;
      const s = (stats[field] ||= { total: 0, correct: 0, answered: 0, invented: 0 });
      const value = got[field] ?? null;
      s.total++;
      if (value !== null) s.answered++;
      if (expected === null && typeof value === "number") s.invented++;
      if (typeof expected === "number" && typeof value === "number" ? Math.abs(expected - value) <= (TOLERANCE[field] ?? 0) : expected === value) s.correct++;
    }
    if (Array.isArray(label.expected.structures)) {
      const seen = new Set(result.visual.structures.filter((x) => x.identification_status === "identificado").map((x) => x.identification));
      structures.expected += label.expected.structures.length;
      structures.identified += label.expected.structures.filter((name) => seen.has(name)).length;
      structures.extra += [...seen].filter((name) => !label.expected.structures.includes(name)).length;
    }
  }
  console.log("Campo | acerto | cobertura | número inventado");
  for (const [field, s] of Object.entries(stats)) console.log(`${field} | ${s.correct}/${s.total} | ${s.answered}/${s.total} | ${s.invented}`);
  if (structures.expected) console.log(`\nEstruturas: ${structures.identified}/${structures.expected} identificadas · ${structures.extra} identificadas a mais`);
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\nExames: ${runs.length} · falhas: ${runs.filter((r) => r.status !== "rascunho_aguardando_veterinario").length} · latência mediana: ${ms[Math.floor(ms.length / 2)] || 0} ms`);
  fs.writeFileSync(path.join(dir, `resultado-${Date.now()}.json`), JSON.stringify({ stats, structures, runs }, null, 2));
})().catch((error) => { console.error(`Falha: ${error.message}`); process.exitCode = 1; });
