"use strict";

/**
 * Agente de Cruzamento (determinístico). Compara o que o Leitor viu com o
 * histórico do animal na AcomGest. Cada verificação devolve o dado que a
 * originou; nenhuma conclui causa ou diagnóstico.
 *
 * severity: "bloqueio" (o rascunho não pode ser aprovado sem o veterinário
 * resolver), "alerta" (conferir), "info".
 */
const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const norm = (v) => String(v || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
const brDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

function parseScreenDate(text) {
  if (!text) return null;
  let m = String(text).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = String(text).match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function crossCheck({ reading, animal, exam, history = {}, config }) {
  const checks = [];
  const add = (code, severity, message, data) => checks.push({ code, severity, message, data });
  const f = reading.findings;

  if (!reading.image_quality.usable) {
    add("imagem_inutilizavel", "bloqueio", `O Leitor marcou a imagem como inutilizável: ${reading.image_quality.issues.join("; ") || "sem detalhe"}.`, { issues: reading.image_quality.issues });
  }

  const screenId = reading.screen_text.animal_id;
  if (screenId && norm(screenId) !== norm(animal.tag)) {
    add("animal_divergente", "bloqueio", `A tela mostra o animal "${screenId}", mas o exame foi aberto para o brinco ${animal.tag}.`, { screen: screenId, selected: animal.tag });
  } else if (!screenId) {
    add("animal_nao_identificado_na_tela", "info", "A identificação do animal não aparece na tela; vale conferir antes de aprovar.", {});
  }

  const screenDate = parseScreenDate(reading.screen_text.exam_date);
  if (screenDate && Math.abs(days(screenDate, exam.date)) > 1) {
    add("data_divergente", "alerta", `A data na tela (${brDate(screenDate)}) difere da data do exame informada (${brDate(exam.date)}).`, { screen: screenDate, informed: exam.date });
  }

  for (const [key, range] of Object.entries(config.ranges)) {
    const value = f[key]?.value;
    if (typeof value === "number" && (value < range.min || value > range.max)) {
      add("fora_da_faixa", "alerta", `${key} = ${value} ${range.unit} está fora da faixa configurada (${range.min} a ${range.max} ${range.unit}).`, { field: key, value, range });
    }
  }

  for (const [key, item] of Object.entries(f)) {
    if (item.value !== null && item.confidence < config.minConfidence) {
      add("baixa_confianca", "alerta", `O Leitor tem baixa confiança em ${key} (${Math.round(item.confidence * 100)}%).`, { field: key, confidence: item.confidence });
    }
    if (["gestational_age_days", "corpus_luteum_mm", "follicle_largest_mm"].includes(key) && item.value !== null && item.source !== "medida_na_tela") {
      add("medida_sem_tela", "bloqueio", `${key} veio sem medida escrita na tela; número estimado a olho não entra no prontuário.`, { field: key, source: item.source });
    }
  }

  const services = (history.services || []).filter((s) => s.date <= exam.date).sort((a, b) => b.date.localeCompare(a.date));
  const lastService = services[0];
  if (f.pregnancy.value === "prenhe") {
    if (!lastService || days(exam.date, lastService.date) > config.serviceLookbackDays) {
      add("prenhe_sem_servico", "alerta", `O Leitor indica prenhez, mas não há inseminação, IATF ou monta registrada nos últimos ${config.serviceLookbackDays} dias.`, { lastService: lastService || null });
    } else if (typeof f.gestational_age_days.value === "number") {
      const sinceService = days(exam.date, lastService.date);
      const diff = f.gestational_age_days.value - sinceService;
      if (Math.abs(diff) > config.gestationalToleranceDays) {
        add("idade_gestacional_divergente", "alerta", `Idade gestacional lida: ${f.gestational_age_days.value} dias. Último serviço registrado (${lastService.type}, ${brDate(lastService.date)}): ${sinceService} dias antes do exame. Diferença de ${Math.abs(diff)} dias.`, { read: f.gestational_age_days.value, sinceService, service: lastService });
      } else {
        add("idade_gestacional_coerente", "info", `Idade gestacional lida (${f.gestational_age_days.value} dias) é coerente com o serviço de ${brDate(lastService.date)} (${sinceService} dias).`, { read: f.gestational_age_days.value, sinceService });
      }
    }
  }

  const previous = (history.ultrasounds || []).filter((u) => u.date < exam.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (f.pregnancy.value === "vazia" && previous?.pregnancy === "prenhe" && days(exam.date, previous.date) <= config.previousPositiveWindowDays) {
    add("vazia_apos_positivo", "alerta", `O exame anterior, de ${brDate(previous.date)}, registrou prenhez; este indica vazia.`, { previous });
  }

  const blocked = checks.some((c) => c.severity === "bloqueio");
  return { checks, blocked, lastService: lastService || null, previousExam: previous || null };
}

module.exports = { crossCheck, parseScreenDate };
