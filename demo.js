#!/usr/bin/env node
"use strict";
/**
 * Demonstração pelo terminal.
 *
 *   GEMINI_API_KEY=... GEMINI_MODEL=gemini-flash-latest \
 *   node agents/ultrasound-agent/demo.js --file exame.mp4 --animal 1042 --date 2026-10-20 --service 2026-09-05:IATF
 *
 *   node agents/ultrasound-agent/demo.js --simulado --file qualquer.png --animal 1042 --date 2026-10-20 --service 2026-09-05:IATF
 *
 * --service pode repetir (data:tipo). --previous data:prenhe|vazia informa um exame anterior.
 * Imprime o rastro de cada etapa e o rascunho; nada é gravado.
 */
const fs = require("node:fs");
const path = require("node:path");
const { runUltrasoundAgent } = require("./src/harness");
const { createGeminiClient } = require("./src/gemini");
const { simulatedClient } = require("./src/simulated");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/avi" };
const args = process.argv.slice(2);
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const one = (name) => all(name)[0];

(async () => {
  const files = all("file");
  if (!files.length || !one("animal") || !one("date")) {
    console.error("Uso: node demo.js --file <imagem|vídeo> [--file ...] --animal <brinco> --date AAAA-MM-DD [--service AAAA-MM-DD:IATF] [--previous AAAA-MM-DD:prenhe] [--simulado]");
    process.exit(2);
  }
  const simulated = args.includes("--simulado");
  const model = process.env.GEMINI_MODEL || process.env.ACOMGEST_ULTRASOUND_VLM_MODEL || "";
  const client = simulated ? simulatedClient() : createGeminiClient({ apiKey: String(process.env.GEMINI_API_KEY || "").trim(), model });
  const result = await runUltrasoundAgent({
    animal: { id: `demo-${one("animal")}`, tag: one("animal") },
    exam: { date: one("date"), equipment: one("equipment") || "" },
    media: files.map((f) => ({ mimeType: MIME[path.extname(f).toLowerCase()] || "application/octet-stream", buffer: fs.readFileSync(f) })),
    history: {
      services: all("service").map((s) => ({ date: s.split(":")[0], type: s.split(":")[1] || "IA" })),
      ultrasounds: all("previous").map((s) => ({ date: s.split(":")[0], pregnancy: s.split(":")[1] }))
    }
  }, {
    vlmClient: client, writerClient: simulated ? null : client,
    // --max-mb aumenta o limite por arquivo na demonstração (o envio direto ao Gemini aceita até ~15 MB por pedido).
    config: one("max-mb") ? { media: { maxBytesPerFile: Number(one("max-mb")) * 1048576, maxTotalBytes: Number(one("max-mb")) * 1048576 } } : {}
  });

  if (simulated) console.log("*** MODO SIMULADO: leitura fictícia, sem análise real da imagem ***\n");
  console.log(`Status: ${result.status}`);
  for (const step of result.trace.steps) console.log(`  · ${step.name}${step.ok === false ? " (falhou)" : ""}${step.usage ? ` — ${step.usage.inputTokens}+${step.usage.outputTokens} tokens, ${step.usage.ms} ms` : ""}`);
  if (result.problems) console.log(`\nProblemas:\n  - ${result.problems.join("\n  - ")}`);
  if (result.checks) {
    console.log("\nVerificações:");
    for (const c of result.checks) console.log(`  [${c.severity}] ${c.message}`);
  }
  if (result.draft) {
    console.log("\nRascunho (aguardando o médico-veterinário):");
    console.log(JSON.stringify(result.draft, null, 2));
  }
  process.exitCode = result.status === "rascunho_aguardando_veterinario" ? 0 : 1;
})().catch((error) => { console.error(`Falha: ${error.message}`); process.exitCode = 1; });
