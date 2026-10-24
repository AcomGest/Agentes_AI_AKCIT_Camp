"use strict";

/**
 * Contrato da saída do Leitor (VLM). O mesmo objeto vai para o Gemini como
 * responseJsonSchema e é revalidado aqui: o modelo só sugere, o código decide
 * o que é aceito.
 */
const finding = (valueSchema) => ({
  type: "object",
  properties: {
    value: valueSchema,
    confidence: { type: "number" },
    evidence: { type: "string" },
    source: { type: "string", enum: ["medida_na_tela", "texto_na_tela", "observacao_visual", "nao_visivel"] }
  },
  required: ["value", "confidence", "evidence", "source"]
});

const VLM_SCHEMA = {
  type: "object",
  properties: {
    screen_text: {
      type: "object",
      properties: {
        animal_id: { type: ["string", "null"] },
        exam_date: { type: ["string", "null"] },
        equipment: { type: ["string", "null"] },
        measurements: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "number" }, unit: { type: "string" } },
            required: ["label", "value", "unit"]
          }
        }
      },
      required: ["animal_id", "exam_date", "equipment", "measurements"]
    },
    findings: {
      type: "object",
      properties: {
        pregnancy: finding({ type: ["string", "null"], enum: ["prenhe", "vazia", "indeterminado", null] }),
        gestational_age_days: finding({ type: ["number", "null"] }),
        corpus_luteum_mm: finding({ type: ["number", "null"] }),
        follicle_largest_mm: finding({ type: ["number", "null"] }),
        uterine_horn: finding({ type: ["string", "null"], enum: ["direito", "esquerdo", "ambos", null] }),
        fluid_presence: finding({ type: ["string", "null"], enum: ["sim", "nao", null] }),
        fetal_heartbeat: finding({ type: ["string", "null"], enum: ["visivel", "nao_visivel", null] })
      },
      required: ["pregnancy", "gestational_age_days", "corpus_luteum_mm", "follicle_largest_mm", "uterine_horn", "fluid_presence", "fetal_heartbeat"]
    },
    image_quality: {
      type: "object",
      properties: { usable: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
      required: ["usable", "issues"]
    },
    // v2: descrição técnica e anatômica para o laudo. Nada daqui vai para os
    // campos do prontuário: estimativas e hipóteses ficam em seções marcadas.
    technical: {
      type: "object",
      properties: {
        mode: { type: ["string", "null"] }, transducer: { type: ["string", "null"] }, frequency_mhz: { type: ["number", "null"] },
        depth_cm: { type: ["number", "null"] }, preset: { type: ["string", "null"] }, is_video: { type: "boolean" },
        quality: { type: "string", enum: ["EXCELENTE", "BOA", "REGULAR", "RUIM"] }, artifacts: { type: "array", items: { type: "string" } }
      },
      required: ["mode", "transducer", "frequency_mhz", "depth_cm", "preset", "is_video", "quality", "artifacts"]
    },
    structures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, in_ontology: { type: "boolean" },
          confidence_level: { type: "string", enum: ["ALTA", "MODERADA", "BAIXA"] }, justification: { type: "string" },
          location: { type: "string" }, side: { type: "string", enum: ["direito", "esquerdo", "indeterminado"] },
          major_mm: { type: ["number", "null"] }, minor_mm: { type: ["number", "null"] }, calibrated: { type: "boolean" },
          echogenicity: { type: "string" }, description: { type: "string" }
        },
        required: ["name", "in_ontology", "confidence_level", "justification", "location", "side", "major_mm", "minor_mm", "calibrated", "echogenicity", "description"]
      }
    },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding: { type: "string" }, compatible_with: { type: "string" },
          confidence_level: { type: "string", enum: ["ALTA", "MODERADA", "BAIXA"] }, justification: { type: "string" },
          confirm_by: { type: "string" }
        },
        required: ["finding", "compatible_with", "confidence_level", "justification", "confirm_by"]
      }
    },
    limitations: {
      type: "array",
      items: {
        type: "object",
        properties: { item: { type: "string" }, kind: { type: "string", enum: ["nao_visualizado", "ausencia_confirmada", "limitacao_tecnica"] } },
        required: ["item", "kind"]
      }
    }
  },
  required: ["screen_text", "findings", "image_quality", "technical", "structures", "hypotheses", "limitations"]
};

const ONTOLOGY = ["ovário", "folículo", "corpo lúteo", "cavidade luteal", "corno uterino", "corpo uterino", "conteúdo uterino", "vesícula embrionária", "embrião/feto"];

const FINDING_KEYS = Object.keys(VLM_SCHEMA.properties.findings.properties);

/** Validador mínimo do subconjunto de JSON Schema usado acima (sem dependências). */
function validate(schema, value, path = "$") {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isFinite(v) ? "number" : "nan") : typeof v);
  const actual = typeOf(value);
  if (types.length && !types.includes(actual)) {
    errors.push(`${path}: esperado ${types.join("|")}, veio ${actual}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: valor fora da lista (${JSON.stringify(value)})`);
  if (actual === "object" && schema.properties) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${path}.${key}: obrigatório`);
    for (const [key, sub] of Object.entries(schema.properties)) if (key in value) errors.push(...validate(sub, value[key], `${path}.${key}`));
  }
  if (actual === "array" && schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  return errors;
}

/** Confiança sempre entre 0 e 1; valor nulo nunca tem confiança alta. */
function normalizeFindings(output) {
  for (const key of FINDING_KEYS) {
    const f = output.findings[key];
    f.confidence = Math.max(0, Math.min(1, Number(f.confidence) || 0));
    if (f.value === null) f.confidence = 0;
  }
  // A ontologia é conferida pelo código, não pela palavra do modelo.
  for (const s of output.structures || []) s.in_ontology = ONTOLOGY.includes(String(s.name || "").trim().toLowerCase());
  return output;
}

module.exports = { VLM_SCHEMA, FINDING_KEYS, ONTOLOGY, validate, normalizeFindings };
