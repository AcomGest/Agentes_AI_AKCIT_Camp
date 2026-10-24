#!/usr/bin/env node
"use strict";
/**
 * Validação com um vídeo de referência (nenhum achado fica fixo no código):
 *
 *   GEMINI_API_KEY=... GEMINI_MODEL=... node eval/validate-reference.js <vídeo>
 *
 * 1. Análise normal: achados visuais, quadros citados, cobertura.
 * 2. Mesmo vídeo com outro brinco, nome e histórico: os achados visuais não
 *    podem mudar por causa disso (o leitor visual não recebe esses dados).
 * 3. Leitor visual só vê a região recortada (textos periféricos ocultos).
 * 4. Arquivo corrompido: falha de processamento, não "ausência de achados".
 * 5. Toda estrutura afirmada cita quadros existentes.
 */
const fs = require("node:fs");
const { runUltrasoundAgent } = require("../src/harness");
const { createGeminiClient } = require("../src/gemini");

const file = process.argv[2];
if (!file) { console.error("Uso: node eval/validate-reference.js <vídeo>"); process.exit(2); }
const client = createGeminiClient({ apiKey: String(process.env.GEMINI_API_KEY || "").trim(), model: process.env.GEMINI_MODEL || "gemini-flash-latest", timeoutMs: 150000 });
const media = [{ mimeType: /\.avi$/i.test(file) ? "video/avi" : "video/mp4", buffer: fs.readFileSync(file) }];
const big = { media: { maxBytesPerFile: 15 * 1048576, maxTotalBytes: 15 * 1048576 } };
const summary = (r) => r.visual.structures.map((s) => `${s.identification} [${s.identification_status}] quadros ${s.frames.join(",") || "-"} · ${s.state}`);
const ok = (cond, label) => { console.log(`${cond ? "OK  " : "FALHA"} ${label}`); return cond; };

(async () => {
  const a = await runUltrasoundAgent({ animal: { id: "a", tag: "1042", name: "Mimosa" }, exam: { date: "2025-10-22", species: "bovina" }, media, history: { services: [{ date: "2025-09-01", type: "IATF" }], ultrasounds: [] } }, { vlmClient: client, writerClient: client, config: big });
  console.log(`\n1. Análise normal — status ${a.status}`);
  console.log(`   cobertura: ${JSON.stringify(a.coverage)}`);
  console.log(`   texto da tela: ${a.screen.texts.map((t) => `"${t.text}" (${t.likely_role})`).join("; ")}`);
  summary(a).forEach((l) => console.log(`   · ${l}`));
  console.log(`   gestação: ${a.visual.gestation.status} · não avaliado: ${a.visual.not_evaluated.map((n) => n.structure).join(", ")}`);
  console.log(`   conferência: ${a.checks.map((c) => `${c.severity}:${c.code}`).join(", ")}`);
  console.log(`   narrativa (${a.narrativeSource}): ${a.draft.notes}`);

  const b = await runUltrasoundAgent({ animal: { id: "b", tag: "7777", name: "Outra" }, exam: { date: "2025-10-22", species: "bovina" }, media, history: { services: [], ultrasounds: [{ date: "2025-10-01", pregnancy: "prenhe" }] } }, { vlmClient: client, writerClient: null, config: big });
  console.log(`\n2. Outro brinco, nome e histórico — status ${b.status}`);
  summary(b).forEach((l) => console.log(`   · ${l}`));
  const ids = (r) => r.visual.structures.filter((s) => s.identification_status !== "não identificado com segurança").map((s) => s.identification).sort().join("|");
  ok(ids(a) === ids(b), `estruturas identificadas iguais (${ids(a) || "nenhuma"} × ${ids(b) || "nenhuma"})`);
  ok(a.visual.gestation.status === b.visual.gestation.status, `status de gestação igual (${a.visual.gestation.status})`);

  console.log("\n3. Textos periféricos");
  ok(Boolean(a.provenance.roi), `leitor visual recebeu só a região recortada ${JSON.stringify(a.provenance.roi)}`);
  ok(!JSON.stringify(a.visual).includes("Gabriel") && !JSON.stringify(a.visual).includes("1042"), "a descrição visual não contém texto da tela nem do cadastro");

  const c = await runUltrasoundAgent({ animal: { id: "c", tag: "1042" }, exam: { date: "2025-10-22" }, media: [{ mimeType: "video/avi", buffer: Buffer.from("isto não é um vídeo") }], history: {} }, { vlmClient: client });
  console.log("\n4. Arquivo corrompido");
  ok(c.status === "falha_no_processamento", `status ${c.status}: ${(c.problems || []).join(" ")}`);

  console.log("\n5. Referência de quadros");
  const n = a.frames.length;
  ok(a.visual.structures.filter((s) => s.identification_status === "identificado").every((s) => s.frames.length && s.frames.every((f) => f >= 1 && f <= n)), `toda estrutura identificada cita quadros entre 1 e ${n}`);
  fs.writeFileSync(`${process.env.TEMP || "/tmp"}/depois.json`, JSON.stringify({ a: { ...a, frames: a.frames.map((f) => ({ ...f, thumb: "(omitido)" })) } }, null, 1));
})().catch((error) => { console.error(`Falha: ${error.message}`); process.exitCode = 1; });
