"use strict";

/**
 * Contratos dos dois leitores (v3). Vão para o Gemini como
 * responseJsonSchema e são revalidados aqui: o modelo só sugere.
 *
 * SCREEN_SCHEMA — Leitor de tela: só o texto escrito pelo aparelho. Nenhum
 *   texto vira automaticamente nome do animal: o significado fica "não
 *   confirmado" e a conferência com o cadastro é feita pelo Cruzamento.
 * VISUAL_SCHEMA — Leitor visual: só a região ultrassonográfica recortada, sem
 *   cadastro, histórico ou texto da tela. Descrição separada de interpretação,
 *   status categórico (sem percentuais), cada estrutura ligada aos quadros.
 */
const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const numOrNull = { type: ["number", "null"] };

const SCREEN_SCHEMA = {
  type: "object",
  properties: {
    texts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: str,
          position: { type: "string", enum: ["topo", "base", "esquerda", "direita", "dentro da imagem"] },
          likely_role: { type: "string", enum: ["identificação do paciente", "data/hora", "aparelho", "transdutor", "parâmetro de aquisição", "medida", "orientação", "outro"] }
        },
        required: ["text", "position", "likely_role"]
      }
    },
    exam_date: strOrNull,
    exam_time: strOrNull,
    equipment: strOrNull,
    transducer: strOrNull,
    frequency_mhz: numOrNull,
    depth_cm: numOrNull,
    measurements: {
      type: "array",
      items: { type: "object", properties: { label: str, value: { type: "number" }, unit: str }, required: ["label", "value", "unit"] }
    }
  },
  required: ["texts", "exam_date", "exam_time", "equipment", "transducer", "frequency_mhz", "depth_cm", "measurements"]
};

const IDENT_STATUS = ["identificado", "hipótese", "não identificado com segurança"];
const STATE = ["compatível com o esperado no que foi visualizado", "alteração morfológica suspeita", "inconclusiva"];
const ONTOLOGY = ["ovário", "folículo", "corpo lúteo", "cavidade luteal", "corno uterino", "corpo uterino", "conteúdo uterino", "vesícula gestacional", "embrião/feto"];

const VISUAL_SCHEMA = {
  type: "object",
  properties: {
    image_quality: {
      type: "object",
      properties: { usable: { type: "boolean" }, issues: { type: "array", items: str } },
      required: ["usable", "issues"]
    },
    structures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: str,
          identification: str,
          identification_status: { type: "string", enum: IDENT_STATUS },
          frames: { type: "array", items: { type: "integer" } },
          location_in_frame: str,
          evidence: str,
          shape: str, contours: str, echogenicity: str, echotexture: str,
          content: { type: "string", enum: ["sólido", "líquido", "misto", "não avaliável"] },
          internal_features: str,
          parent_id: strOrNull,
          relations: str,
          possible_artifact: { type: "boolean" },
          state: { type: "string", enum: STATE },
          state_basis: str,
          suspected_changes: {
            type: "array",
            items: {
              type: "object",
              properties: { observed: str, possible_meaning: str, pathologic_hypothesis: strOrNull, differentials: { type: "array", items: str }, confirm_by: str },
              required: ["observed", "possible_meaning", "pathologic_hypothesis", "differentials", "confirm_by"]
            }
          },
          limitations: str
        },
        required: ["id", "identification", "identification_status", "frames", "location_in_frame", "evidence", "shape", "contours", "echogenicity", "echotexture", "content", "internal_features", "parent_id", "relations", "possible_artifact", "state", "state_basis", "suspected_changes", "limitations"]
      }
    },
    not_evaluated: {
      type: "array",
      items: { type: "object", properties: { structure: str, reason: str }, required: ["structure", "reason"] }
    },
    gestation: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["estruturas gestacionais identificadas", "não demonstrada neste clipe", "inconclusiva"] },
        frames: { type: "array", items: { type: "integer" } },
        basis: str
      },
      required: ["status", "frames", "basis"]
    },
    preliminary_interpretation: {
      type: "object",
      properties: { text: str, basis: str },
      required: ["text", "basis"]
    }
  },
  required: ["image_quality", "structures", "not_evaluated", "gestation", "preliminary_interpretation"]
};

/** Validador mínimo do subconjunto de JSON Schema usado acima (sem dependências). */
function validate(schema, value, path = "$") {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isFinite(v) ? (Number.isInteger(v) ? "integer" : "number") : "nan") : typeof v);
  let actual = typeOf(value);
  if (actual === "integer" && !types.includes("integer")) actual = "number";
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

/** Ajustes que o código impõe à leitura visual, independentemente do modelo. */
function normalizeVisual(output, frameCount) {
  const valid = (list) => [...new Set((list || []).filter((n) => Number.isInteger(n) && n >= 1 && n <= frameCount))];
  for (const s of output.structures) {
    s.frames = valid(s.frames);
    s.in_ontology = ONTOLOGY.includes(String(s.identification || "").trim().toLowerCase());
    // Afirmação visual sem quadro de referência não pode ser conferida: rebaixa para hipótese.
    if (!s.frames.length && s.identification_status === "identificado") s.identification_status = "hipótese";
  }
  output.gestation.frames = valid(output.gestation.frames);
  if (output.gestation.status === "estruturas gestacionais identificadas" && !output.gestation.frames.length) output.gestation.status = "inconclusiva";
  return output;
}

module.exports = { SCREEN_SCHEMA, VISUAL_SCHEMA, ONTOLOGY, IDENT_STATUS, STATE, validate, normalizeVisual };
