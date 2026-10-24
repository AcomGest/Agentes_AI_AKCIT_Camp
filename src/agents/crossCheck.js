"use strict";

/**
 * Agente de Cruzamento (determinístico). Confere as FONTES entre si:
 * texto da tela × cadastro, datas, medidas da tela × faixas, achados visuais ×
 * histórico. Nenhuma verificação decide qual fonte está certa: mostra as duas
 * para o veterinário conferir. Cadastro, histórico e texto da tela nunca são
 * usados como evidência de estrutura anatômica.
 *
 * severity: "bloqueio" (não pode assinar sem resolver), "alerta" (conferir), "info".
 */
const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
const brDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

function parseScreenDate(text) {
  if (!text) return null;
  let m = String(text).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = String(text).match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function crossCheck({ screen, visual, derived, animal, exam, history = {}, config }) {
  const checks = [];
  const add = (code, severity, message, data, section) => checks.push({ code, severity, message, data, section });

  if (!visual.image_quality.usable) {
    add("imagem_inutilizavel", "bloqueio", `O leitor visual marcou a imagem como não avaliável: ${visual.image_quality.issues.join("; ") || "sem detalhe"}.`, { issues: visual.image_quality.issues }, "visual");
  }

  // Identificação: texto da tela tem significado não confirmado.
  const idTexts = (screen.texts || []).filter((t) => t.likely_role === "identificação do paciente").map((t) => t.text);
  const known = [animal.tag, animal.name].filter(Boolean).map(norm);
  if (!idTexts.length) {
    add("identificacao_ausente_na_tela", "info", "A tela não mostra identificação do paciente; confira o animal antes de assinar.", {}, "conferencia");
  } else if (idTexts.some((t) => known.includes(norm(t)))) {
    add("identificacao_confere", "info", `O texto da tela (${idTexts.join(", ")}) coincide com o cadastro do exame.`, { screen: idTexts }, "conferencia");
  } else {
    add("identificacao_a_conferir", "alerta", `A tela mostra "${idTexts.join(", ")}" na área do paciente; o significado desse texto não está confirmado (pode ser o animal, o proprietário ou outro campo). O exame foi aberto para ${animal.tag}${animal.name ? ` · ${animal.name}` : ""}. Conferir a identificação.`, { screen: idTexts, registry: { tag: animal.tag, name: animal.name || null } }, "conferencia");
  }

  const screenDate = parseScreenDate(screen.exam_date);
  if (screenDate && screenDate !== exam.date) {
    add("data_a_conferir", "alerta", `Data na tela: ${brDate(screenDate)}. Data informada no exame: ${brDate(exam.date)}. Conferir qual vale para o prontuário.`, { screen: screenDate, informed: exam.date }, "conferencia");
  }

  for (const [key, m] of Object.entries(derived.measurements)) {
    const range = config.ranges[key];
    if (m && range && (m.value < range.min || m.value > range.max)) {
      add("medida_fora_da_faixa", "alerta", `Medida da tela ${m.label} = ${m.value} ${range.unit} fora da faixa configurada (${range.min} a ${range.max} ${range.unit}).`, { field: key, measurement: m, range }, "conferencia");
    }
  }

  // Histórico: só contextualiza; nunca prova ou nega estrutura.
  const services = (history.services || []).filter((s) => s.date <= exam.date).sort((a, b) => b.date.localeCompare(a.date));
  const lastService = services[0] || null;
  const gestationShown = visual.gestation.status === "estruturas gestacionais identificadas";
  if (gestationShown && (!lastService || days(exam.date, lastService.date) > config.serviceLookbackDays)) {
    add("gestacao_sem_servico", "alerta", `O leitor visual indicou estruturas gestacionais, mas não há inseminação, IATF ou monta registrada nos últimos ${config.serviceLookbackDays} dias.`, { lastService }, "historico");
  }
  const ga = derived.measurements.gestational_age_days;
  if (ga && lastService) {
    const since = days(exam.date, lastService.date);
    const diff = ga.value - since;
    add(Math.abs(diff) > config.gestationalToleranceDays ? "idade_gestacional_divergente" : "idade_gestacional_coerente",
      Math.abs(diff) > config.gestationalToleranceDays ? "alerta" : "info",
      `Idade gestacional medida na tela: ${ga.value} dias. Último serviço registrado (${lastService.type}, ${brDate(lastService.date)}): ${since} dias antes do exame.`, { measured: ga.value, since, service: lastService }, "historico");
  }
  const previous = (history.ultrasounds || []).filter((u) => u.date < exam.date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  if (previous?.pregnancy === "prenhe" && !gestationShown && days(exam.date, previous.date) <= config.previousPositiveWindowDays) {
    add("positivo_anterior", "alerta", `O exame de ${brDate(previous.date)} registrou prenhez. Este clipe não demonstra estruturas gestacionais, o que não equivale a resultado negativo.`, { previous }, "historico");
  }

  return { checks, blocked: checks.some((c) => c.severity === "bloqueio"), lastService, previousExam: previous };
}

module.exports = { crossCheck, parseScreenDate };
