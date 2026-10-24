"use strict";

/**
 * Cliente mínimo da API do Gemini (generateContent), sem dependências.
 * Mesmo padrão do fornecedor já usado na AcomGest: chave no cabeçalho,
 * temperatura 0, saída JSON validada por schema, erro do provedor sem ecoar
 * o pedido.
 */
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function createGeminiClient({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");
  if (!model) throw new Error("Modelo do Gemini não configurado (GEMINI_MODEL).");

  async function generate({ instructions, parts, schema }) {
    const generationConfig = { temperature: 0 };
    if (schema) Object.assign(generationConfig, { responseMimeType: "application/json", responseJsonSchema: schema });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    let response;
    try {
      response = await fetchImpl(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: "user", parts }], generationConfig }),
        signal: controller.signal
      });
    } catch (error) {
      throw new Error(error.name === "AbortError" ? `Gemini não respondeu em ${timeoutMs / 1000}s.` : `Falha de rede ao chamar o Gemini: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Gemini recusou o pedido (HTTP ${response.status}${body?.error?.status ? ` ${body.error.status}` : ""}).`);
    const usage = body.usageMetadata || {};
    const text = (body.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (!text) throw new Error(`Gemini não devolveu resposta (${body.candidates?.[0]?.finishReason || "sem motivo"}).`);
    return { text, usage: { inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, ms: Date.now() - started } };
  }

  return { model, generate };
}

const mediaPart = (buffer, mimeType) => ({ inlineData: { mimeType, data: Buffer.from(buffer).toString("base64") } });

module.exports = { createGeminiClient, mediaPart };
