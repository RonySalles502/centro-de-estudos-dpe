const state = {
  dashboard: null,
  disciplines: [],
  program: [],
  jurisprudence: [],
  sources: [],
  backups: [],
  questionStats: null,
  questionSources: [],
  questions: [],
  quizSessions: [],
  activeQuiz: null,
  diagnostic: null,
  plan: null,
  planWeekIndex: null,
  planWeekRunId: null,
  reviews: [],
  discursivePrompts: [],
  discursiveAttempts: [],
  activeDiscursivePrompt: null,
  activeDiscursiveAttempt: null,
  quizTimers: {},
  programRequest: 0,
  questionRequest: 0,
  jurisRequest: 0,
};

const labels = {
  NAO_INICIADO: "Não iniciado",
  EM_ESTUDO: "Em estudo",
  REVISAO: "Revisão",
  CONSOLIDADO: "Consolidado",
  ALTA: "Alta",
  MEDIA: "Média",
  BAIXA: "Baixa",
};

const pageInfo = {
  dashboard: ["Painel local", "Visão geral"],
  programa: ["Base oficial", "Programa"],
  questoes: ["Prática direcionada", "Questões"],
  simulados: ["Resolução persistente", "Simulados"],
  jurisprudencia: ["Atualização jurídica", "Jurisprudência"],
  diagnostico: ["Perfil de estudo", "Diagnóstico"],
  planejamento: ["Cronograma adaptativo", "Planejamento"],
  revisoes: ["Retenção do conteúdo", "Revisão espaçada"],
  discursivas: ["Produção jurídica", "Discursivas"],
  backup: ["Instância individual", "Dados e backup"],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Falha HTTP ${response.status}`);
  return payload;
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type === "error" ? "error" : ""}`;
  element.textContent = message;
  $("#toast-region").append(element);
  setTimeout(() => element.remove(), 4600);
}

function formatDate(value, includeTime = false) {
  if (!value) return "ainda não executada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(includeTime ? { timeStyle: "short" } : {}),
  }).format(date);
}

function showView(view) {
  $$(".view").forEach((element) => element.classList.toggle("is-active", element.dataset.section === view));
  $$(".nav-item").forEach((element) => element.classList.toggle("is-active", element.dataset.view === view));
  const [eyebrow, title] = pageInfo[view];
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  document.body.classList.remove("menu-open");
  location.hash = view === "dashboard" ? "" : view;
  if (view === "programa") loadProgram();
  if (view === "questoes") loadQuestionBank();
  if (view === "simulados") loadSimulators();
  if (view === "jurisprudencia") loadJurisprudence();
  if (view === "diagnostico") loadDiagnostic();
  if (view === "planejamento") loadPlan();
  if (view === "revisoes") loadReviews();
  if (view === "discursivas") loadDiscursives();
  if (view === "backup") loadBackups();
  $("#conteudo").focus({ preventScroll: true });
}

function percent(value) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value || 0);
}

function renderDashboard() {
  const { metrics, jurisprudence, groups, sources, settings } = state.dashboard;
  $("#metric-started").textContent = percent(metrics.started_topics / metrics.total_topics);
  $("#metric-started-note").textContent = `${metrics.started_topics} de ${metrics.total_topics} tópicos`;
  $("#metric-consolidated").textContent = metrics.consolidated_topics;
  $("#metric-questions").textContent = metrics.questions_done;
  $("#metric-accuracy").textContent = metrics.accuracy == null ? "sem desempenho registrado" : `${percent(metrics.accuracy)} de acerto`;
  $("#metric-juris").textContent = jurisprudence.pending;

  if (settings.target_exam_date) {
    const target = new Date(`${settings.target_exam_date}T12:00:00`);
    const today = new Date();
    const days = Math.max(0, Math.ceil((target - today) / 86400000));
    $("#days-to-exam").textContent = days;
    $("#target-date-label").textContent = `${formatDate(settings.target_exam_date)} · estimativa editável`;
  } else {
    $("#days-to-exam").textContent = "—";
  }

  $("#group-progress").innerHTML = groups.map((group) => {
    const coverage = group.total ? group.consolidated / group.total : 0;
    return `
      <div class="group-row">
        <span class="group-label">Grupo ${escapeHtml(group.group_name)}</span>
        <div class="progress-track" aria-label="${percent(coverage)} consolidado">
          <div class="progress-fill" style="width:${Math.max(2, coverage * 100)}%"></div>
        </div>
        <span class="group-value">${group.consolidated}/${group.total}</span>
      </div>`;
  }).join("");

  $("#source-summary").innerHTML = sources.map((source) => {
    const health = source.last_error ? "error" : source.last_success_at ? "ok" : "pending";
    const label = source.last_error ? "Falhou" : source.last_success_at ? "Atualizada" : "Pendente";
    return `
      <div class="source-line">
        <span class="source-badge">${escapeHtml(source.court)}</span>
        <div><strong>${escapeHtml(source.name)}</strong><small>${formatDate(source.last_success_at, true)}</small></div>
        <span class="health-label ${health}">${label}</span>
      </div>`;
  }).join("");

  renderTodayAgenda();
}

async function loadDashboard() {
  const [dashboard, plan, reviews] = await Promise.all([
    api("/api/dashboard"),
    api("/api/planning"),
    api("/api/reviews?scope=due&limit=20"),
  ]);
  state.dashboard = dashboard;
  state.plan = plan;
  state.reviews = reviews.items;
  renderDashboard();
  fillSettings(state.dashboard.settings);
}

function renderTodayAgenda() {
  const target = $("#today-agenda");
  const focus = $("#dashboard-focus");
  const focusTitle = $("strong", focus);
  const focusText = $("p", focus);
  const focusButton = $("button", focus);
  const plan = state.plan;
  if (!plan?.run) {
    $("#today-agenda-title").textContent = "Monte sua rota de estudo";
    target.innerHTML = `<div class="empty-state compact-empty"><strong>Nenhum cronograma ativo</strong>Preencha o diagnóstico uma vez; o sistema organizará os blocos, a legislação e as revisões.</div>`;
    focusTitle.textContent = "Configure uma vez, estude todos os dias";
    focusText.textContent = "O diagnóstico transforma sua disponibilidade em um calendário acionável.";
    focusButton.textContent = "Fazer diagnóstico";
    focusButton.dataset.go = "diagnostico";
    return;
  }
  const today = localDayIso(new Date());
  let selectedDate = today;
  let includesCarryover = false;
  let items = plan.items.filter((item) => item.scheduled_date <= today && item.status === "PLANEJADO");
  includesCarryover = items.some((item) => item.scheduled_date < today);
  if (!items.length) {
    const next = plan.items.find((item) => item.scheduled_date > today && item.status === "PLANEJADO");
    if (next) {
      selectedDate = next.scheduled_date;
      items = plan.items.filter((item) => item.scheduled_date === selectedDate && item.status === "PLANEJADO");
    }
  }
  if (items.length) {
    const visibleItems = items.slice(0, 3);
    const minutes = visibleItems.reduce((sum, item) => sum + item.duration_minutes, 0);
    $("#today-agenda-title").textContent = selectedDate === today
      ? includesCarryover ? "Prioridades de hoje · com pendências" : "Agenda do dia"
      : `Próxima agenda · ${formatLocalDate(selectedDate)}`;
    target.innerHTML = `<div class="plan-entry-list">${visibleItems.map(planEntryCard).join("")}</div>${items.length > 3 ? `<small class="agenda-more">Mais ${items.length - 3} bloco(s) aguardam no calendário.</small>` : ""}`;
    focusTitle.textContent = `${visibleItems.length} próximo${visibleItems.length === 1 ? " bloco" : "s blocos"} · ${formatStudyMinutes(minutes)}`;
    focusText.textContent = selectedDate === today
      ? includesCarryover ? "O sistema trouxe primeiro os blocos anteriores ainda pendentes." : "Sua rota de hoje já está pronta."
      : "O ciclo atual está em dia; esta é a próxima carga planejada.";
    focusButton.textContent = "Abrir calendário";
    focusButton.dataset.go = "planejamento";
    return;
  }
  if (state.reviews.length) {
    $("#today-agenda-title").textContent = "Revisões devidas";
    target.innerHTML = state.reviews.slice(0, 3).map((item) => `<article class="agenda-review"><span class="court-pill">Grupo ${escapeHtml(item.objective_group)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.discipline_name)}</small></article>`).join("");
    focusTitle.textContent = `${state.reviews.length} revisão${state.reviews.length === 1 ? "" : "ões"} para retomar`;
    focusText.textContent = "O calendário foi concluído; mantenha a retenção com a fila espaçada.";
    focusButton.textContent = "Abrir revisões";
    focusButton.dataset.go = "revisoes";
    return;
  }
  $("#today-agenda-title").textContent = "Ciclo concluído";
  target.innerHTML = `<div class="empty-state compact-empty"><strong>Nenhuma pendência</strong>Gere o próximo ciclo quando quiser continuar.</div>`;
  focusTitle.textContent = "Ciclo concluído";
  focusText.textContent = "Não há blocos ou revisões pendentes neste momento.";
  focusButton.textContent = "Gerar próximo ciclo";
  focusButton.dataset.go = "planejamento";
}

async function loadDisciplines() {
  const payload = await api("/api/disciplines");
  state.disciplines = payload.items;
  const options = state.disciplines
    .map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)}</option>`)
    .join("");
  $("#program-discipline").innerHTML = `<option value="">Todas as disciplinas</option>${options}`;
  $("#question-discipline").innerHTML = `<option value="">Todas as disciplinas</option>${options}`;
  $("#quiz-discipline").innerHTML = `<option value="">Todas as disciplinas</option>${options}`;
  $("#new-prompt-discipline").innerHTML = `<option value="">Sem disciplina</option>${options}`;
}

function topicCard(topic) {
  const accuracy = topic.questions_done ? topic.correct_answers / topic.questions_done : null;
  const source = topic.source_page ? `p. ${topic.source_page}` : "página não indicada";
  return `
    <details class="topic-card" data-topic-id="${escapeHtml(topic.id)}">
      <summary>
        <span class="topic-id">${escapeHtml(topic.id)}</span>
        <span class="topic-title">
          <strong>${escapeHtml(topic.title)}</strong>
          <small>${escapeHtml(topic.discipline_name)} · item ${topic.item_number}</small>
        </span>
        <span class="status-pill ${topic.study_status.toLowerCase()}">${labels[topic.study_status]}</span>
        <span class="chevron" aria-hidden="true">›</span>
      </summary>
      <div class="topic-details">
        <p class="topic-source">
          <strong>Fonte:</strong> Resolução nº 344/2025 consolidada, ${source}.
          ${topic.referenced_norms ? `<br><strong>Normas identificadas:</strong> ${escapeHtml(topic.referenced_norms)}` : ""}
          <br><a href="${escapeHtml(topic.source_url)}" target="_blank" rel="noreferrer">Abrir fonte oficial</a>
        </p>
        <div class="topic-controls">
          <label><span>Status</span><select data-field="study_status">${statusOptions(topic.study_status)}</select></label>
          <label><span>Prioridade</span><select data-field="priority">${priorityOptions(topic.priority)}</select></label>
          <label><span>Domínio</span><select data-field="mastery">${masteryOptions(topic.mastery)}</select></label>
          <label><span>Questões</span><input data-field="questions_done" type="number" min="0" value="${topic.questions_done}"></label>
          <label><span>Acertos</span><input data-field="correct_answers" type="number" min="0" value="${topic.correct_answers}"><small>${accuracy == null ? "sem taxa" : percent(accuracy)}</small></label>
        </div>
      </div>
    </details>`;
}

function statusOptions(selected) {
  return ["NAO_INICIADO", "EM_ESTUDO", "REVISAO", "CONSOLIDADO"]
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${labels[value]}</option>`).join("");
}

function priorityOptions(selected) {
  return ["ALTA", "MEDIA", "BAIXA"]
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${labels[value]}</option>`).join("");
}

function masteryOptions(selected) {
  return `<option value="" ${selected == null ? "selected" : ""}>—</option>` + [0,1,2,3,4,5]
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
}

async function loadProgram() {
  const requestId = ++state.programRequest;
  $("#program-list").innerHTML = `<div class="loading">Carregando programa oficial…</div>`;
  const params = new URLSearchParams();
  const discipline = $("#program-discipline").value;
  const status = $("#program-status").value;
  const query = $("#program-search").value.trim();
  if (discipline) params.set("discipline", discipline);
  if (status) params.set("status", status);
  if (query) params.set("q", query);
  params.set("limit", "500");
  try {
    const payload = await api(`/api/program?${params}`);
    if (requestId !== state.programRequest) return;
    state.program = payload.items;
    $("#program-count").textContent = `${payload.total} tópico${payload.total === 1 ? "" : "s"}`;
    $("#program-list").innerHTML = payload.items.length
      ? payload.items.map(topicCard).join("")
      : `<div class="empty-state"><strong>Nenhum tópico encontrado</strong>Revise os filtros aplicados.</div>`;
  } catch (error) {
    $("#program-list").innerHTML = `<div class="empty-state"><strong>Falha ao carregar</strong>${escapeHtml(error.message)}</div>`;
  }
}

async function updateTopic(input) {
  const card = input.closest(".topic-card");
  const topicId = card.dataset.topicId;
  let value = input.value;
  if (["mastery", "questions_done", "correct_answers"].includes(input.dataset.field)) {
    value = value === "" ? null : Number(value);
  }
  input.disabled = true;
  try {
    const updated = await api(`/api/program/${encodeURIComponent(topicId)}`, {
      method: "PATCH",
      body: JSON.stringify({ [input.dataset.field]: value }),
    });
    const pill = $(".status-pill", card);
    pill.textContent = labels[updated.study_status];
    pill.className = `status-pill ${updated.study_status.toLowerCase()}`;
    toast(`Progresso salvo em ${topicId}.`);
    await loadDashboard();
  } catch (error) {
    toast(error.message, "error");
    await loadProgram();
  } finally {
    input.disabled = false;
  }
}

const diagnosticWeekdays = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];
const diagnosticContents = ["LEITURA", "QUESTOES", "JURISPRUDENCIA", "REVISAO", "DISCURSIVA", "SIMULADO"];
const diagnosticGroups = ["I", "II", "III", "IV"];
const contentLabels = {
  LEITURA: "Leitura",
  QUESTOES: "Questões",
  JURISPRUDENCIA: "Jurisprudência",
  REVISAO: "Revisão",
  DISCURSIVA: "Discursiva",
  SIMULADO: "Simulado",
};
const experienceLabels = { INICIANTE: "Iniciante", INTERMEDIARIO: "Intermediário", AVANCADO: "Avançado" };
const shiftLabels = { MANHA: "manhã", TARDE: "tarde", NOITE: "noite", FLEXIVEL: "turno flexível" };
const legislationStatusLabels = {
  MAPEADO_PENDENTE_VALIDACAO: "Roteiro pré-edital",
  VALIDADO: "Fonte oficial conferida",
  SEM_DISPOSITIVO_ESPECIFICO: "Tema sem lei seca específica",
  PENDENTE_MAPEAMENTO: "Roteiro normativo em preparação",
};

function legislationStudyNote(status) {
  if (status === "VALIDADO") return "Referência conferida no pacote de conteúdo.";
  if (status === "MAPEADO_PENDENTE_VALIDACAO") return "Roteiro de leitura vinculado ao programa. Abra o texto vigente durante o estudo.";
  if (status === "SEM_DISPOSITIVO_ESPECIFICO") return "Priorize doutrina e jurisprudência neste bloco.";
  return "Estude o tópico; a indicação normativa será incluída em uma atualização do pacote.";
}

function formatStudyMinutes(value) {
  const minutes = Number(value || 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return `${hours}h${remainder ? ` ${remainder}min` : ""}`;
}

function formatLocalDate(value) {
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T12:00:00` : value);
}

function parseLocalDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function localDayIso(value) {
  const date = value instanceof Date ? value : parseLocalDay(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : parseLocalDay(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function planCalendarWeeks(run, items) {
  const start = parseLocalDay(run.start_date);
  const end = parseLocalDay(run.end_date);
  if (!start || !end) return [];
  const itemsByDay = items.reduce((result, item) => {
    (result[item.scheduled_date] ||= []).push(item);
    return result;
  }, {});
  const weeks = [];
  let cursor = new Date(start);
  let currentWeek = null;
  while (cursor <= end) {
    const weekStartsOnMonday = addLocalDays(cursor, -((cursor.getDay() + 6) % 7));
    const weekKey = localDayIso(weekStartsOnMonday);
    if (!currentWeek || currentWeek.key !== weekKey) {
      currentWeek = { key: weekKey, days: [] };
      weeks.push(currentWeek);
    }
    const iso = localDayIso(cursor);
    currentWeek.days.push({ date: iso, items: itemsByDay[iso] || [] });
    cursor = addLocalDays(cursor, 1);
  }
  return weeks.map((week, index) => {
    const weekItems = week.days.flatMap((day) => day.items);
    return {
      ...week,
      number: index + 1,
      startDate: week.days[0].date,
      endDate: week.days.at(-1).date,
      entries: weekItems.length,
      minutes: weekItems.reduce((sum, item) => sum + item.duration_minutes, 0),
      completed: weekItems.filter((item) => item.status === "CONCLUIDO").length,
    };
  });
}

function weekdayName(value) {
  const date = parseLocalDay(value);
  if (!date) return "Dia";
  const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function weekPeriodLabel(week) {
  return `${formatLocalDate(week.startDate)} a ${formatLocalDate(week.endDate)}`;
}

function diagnosticPayload() {
  return {
    experience_level: $("#diag-level").value,
    preferred_shift: $("#diag-shift").value,
    session_minutes: Number($("#diag-session").value),
    horizon_days: Number($("#diag-horizon").value),
    weekday_minutes: Object.fromEntries(diagnosticWeekdays.map((key) => [key, Number($(`#diag-${key}`).value || 0)])),
    content_weights: Object.fromEntries(diagnosticContents.map((key) => [key, Number($(`#content-weight-${key}`).value || 0)])),
    group_weights: Object.fromEntries(diagnosticGroups.map((key) => [key, Number($(`#group-weight-${key}`).value || 0)])),
  };
}

function updateDiagnosticTotals() {
  const payload = diagnosticPayload();
  const weekly = Object.values(payload.weekday_minutes).reduce((sum, value) => sum + value, 0);
  const groupTotal = Object.values(payload.group_weights).reduce((sum, value) => sum + value, 0);
  const contentTotal = Object.values(payload.content_weights).reduce((sum, value) => sum + value, 0);
  $("#diagnostic-weekly-total").textContent = `${formatStudyMinutes(weekly)} por semana`;
  $("#group-weight-total").textContent = `${groupTotal}%`;
  $("#content-weight-total").textContent = `${contentTotal}%`;
  $("#group-weight-total").className = `weight-total ${groupTotal === 100 ? "is-valid" : "is-invalid"}`;
  $("#content-weight-total").className = `weight-total ${contentTotal === 100 ? "is-valid" : "is-invalid"}`;
}

function fillDiagnostic(diagnostic) {
  state.diagnostic = diagnostic;
  diagnosticWeekdays.forEach((key) => { $(`#diag-${key}`).value = diagnostic.weekday_minutes[key] ?? 0; });
  diagnosticContents.forEach((key) => { $(`#content-weight-${key}`).value = diagnostic.content_weights[key] ?? 0; });
  diagnosticGroups.forEach((key) => { $(`#group-weight-${key}`).value = diagnostic.group_weights[key] ?? 0; });
  $("#diag-level").value = diagnostic.experience_level;
  $("#diag-shift").value = diagnostic.preferred_shift;
  $("#diag-session").value = String(diagnostic.session_minutes);
  $("#diag-horizon").value = String(diagnostic.horizon_days);
  updateDiagnosticTotals();
}

async function loadDiagnostic() {
  try {
    fillDiagnostic(await api("/api/diagnostic"));
  } catch (error) {
    toast(error.message, "error");
  }
}

async function saveDiagnostic(event, generate = false) {
  if (event) event.preventDefault();
  if (!$("#diagnostic-form").reportValidity()) return;
  const button = generate ? $("#save-and-generate-plan") : $("#save-diagnostic");
  button.disabled = true;
  try {
    const diagnostic = await api("/api/diagnostic", {
      method: "PATCH",
      body: JSON.stringify(diagnosticPayload()),
    });
    fillDiagnostic(diagnostic);
    toast("Diagnóstico salvo nesta instalação.");
    if (generate) {
      state.plan = await api("/api/planning/generate", { method: "POST", body: "{}" });
      showView("planejamento");
      renderPlan();
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function planMetric(label, value, note) {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function renderAllocation(target, values, keys, formatter) {
  const total = Object.values(values || {}).reduce((sum, value) => sum + value, 0);
  $(target).innerHTML = keys.map((key) => {
    const minutes = values?.[key] || 0;
    const share = total ? minutes / total : 0;
    return formatter(key, minutes, share);
  }).join("");
}

function planEntryCard(item) {
  const statusClass = item.status.toLowerCase();
  const contentClass = item.content_type.toLowerCase();
  const legislationStatus = item.legislation_status || "PENDENTE_MAPEAMENTO";
  const legislation = item.legislation || [];
  const legislationBlock = legislationStatus === "NAO_APLICAVEL" ? "" : `
    <div class="plan-legislation ${legislationStatus.toLowerCase()}">
      <div class="plan-legislation-heading">
        <strong>Lei e artigos para leitura</strong>
        <span>${escapeHtml(legislationStatusLabels[legislationStatus] || legislationStatus)}</span>
      </div>
      ${legislation.length ? `<ul>${legislation.map((reading) => `
        <li>
          <a href="${escapeHtml(reading.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(reading.norm_name)}</a>
          <strong>${escapeHtml(reading.article_reference)}</strong>
        </li>`).join("")}</ul>` : ""}
      <small>${escapeHtml(legislationStudyNote(legislationStatus))}</small>
    </div>`;
  return `
    <article class="plan-entry content-${contentClass} ${statusClass}">
      <div class="plan-entry-body">
        <div class="plan-entry-header">
          <div class="plan-entry-time"><strong>${escapeHtml(contentLabels[item.content_type] || item.content_type)}</strong><span>${formatStudyMinutes(item.duration_minutes)}</span></div>
          <div class="question-card-meta"><span class="court-pill">Grupo ${escapeHtml(item.objective_group || "—")}</span>${item.discipline_name ? `<span>${escapeHtml(item.discipline_name)}</span>` : ""}<span>${escapeHtml(item.status)}</span></div>
        </div>
        <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.rationale || "")}</p>
        ${legislationBlock}
      </div>
      <div class="plan-entry-actions">
        <button class="button button-secondary" data-study-target="${escapeHtml(item.content_type)}" data-study-group="${escapeHtml(item.objective_group || "")}" data-study-discipline="${escapeHtml(item.discipline_code || "")}" data-study-entity="${escapeHtml(item.entity_id || "")}">Estudar agora</button>
        ${item.status !== "CONCLUIDO" ? `<button class="button button-primary" data-plan-entry="${escapeHtml(item.id)}" data-plan-status="CONCLUIDO">Concluir</button>` : `<span class="completed-mark">Concluído</span>`}
        ${item.status === "PLANEJADO" ? `<button class="text-button" data-plan-entry="${escapeHtml(item.id)}" data-plan-status="PULADO">Pular</button>` : ""}
        ${item.status !== "PLANEJADO" ? `<button class="text-button" data-plan-entry="${escapeHtml(item.id)}" data-plan-status="PLANEJADO">Reabrir</button>` : ""}
      </div>
    </article>`;
}

async function openPlanStudy(button) {
  const type = button.dataset.studyTarget;
  if (["QUESTOES", "SIMULADO"].includes(type)) {
    $("#quiz-kind").value = type === "SIMULADO" ? "SIMULADO_GRUPO" : "PRATICA";
    $("#quiz-group").value = button.dataset.studyGroup || "";
    $("#quiz-discipline").value = type === "QUESTOES" ? button.dataset.studyDiscipline || "" : "";
    showView("simulados");
    updateQuizForm();
    return;
  }
  if (type === "JURISPRUDENCIA") {
    showView("jurisprudencia");
    return;
  }
  if (type === "REVISAO") {
    showView("revisoes");
    return;
  }
  if (type === "DISCURSIVA") {
    showView("discursivas");
    await loadDiscursives();
    if (button.dataset.studyEntity) openDiscursivePrompt(button.dataset.studyEntity);
    return;
  }
  if (button.dataset.studyEntity) $("#program-search").value = button.dataset.studyEntity;
  showView("programa");
}

function handlePlanAction(event) {
  const studyButton = event.target.closest("[data-study-target]");
  if (studyButton) {
    openPlanStudy(studyButton);
    return;
  }
  const statusButton = event.target.closest("[data-plan-entry]");
  if (statusButton) updatePlanEntry(statusButton);
}

function renderPlan() {
  const payload = state.plan;
  const hasPlan = Boolean(payload?.run);
  $("#plan-empty").hidden = hasPlan;
  $("#plan-metrics").hidden = !hasPlan;
  $("#plan-week-navigation").innerHTML = "";
  $("#plan-days").innerHTML = "";
  $("#plan-group-summary").innerHTML = "";
  $("#plan-content-summary").innerHTML = "";
  $("#plan-adjustments").hidden = true;
  $("#plan-adjustments").innerHTML = "";
  if (!hasPlan) return;
  const run = payload.run;
  const completedEntries = payload.items.filter((item) => item.status === "CONCLUIDO").length;
  $("#plan-metrics").innerHTML = [
    planMetric("Período", `${run.horizon_days} dias`, `${formatLocalDate(run.start_date)} a ${formatLocalDate(run.end_date)}`),
    planMetric("Carga prevista", formatStudyMinutes(run.total_minutes), `${payload.items.length} blocos`),
    planMetric("Realizado", formatStudyMinutes(payload.summary.completed_minutes), `${percent(payload.summary.completion)} da carga`),
    planMetric(
      "Blocos concluídos",
      completedEntries,
      `${payload.items.length - completedEntries} restantes · ${experienceLabels[payload.summary.experience_level] || "perfil"} · ${shiftLabels[payload.summary.preferred_shift] || "turno flexível"}`,
    ),
  ].join("");
  const adjustments = payload.summary.adjustments || [];
  if (adjustments.length) {
    $("#plan-adjustments").hidden = false;
    $("#plan-adjustments").innerHTML = `<strong>Tempo redistribuído automaticamente.</strong><ul>${adjustments.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><small>Não há tarefa de validação para o candidato.</small>`;
  }
  renderAllocation("#plan-group-summary", payload.summary.group_minutes, diagnosticGroups, (key, minutes, share) => `
    <div class="group-row"><span class="group-label">Grupo ${key}</span><div class="progress-track"><div class="progress-fill" style="width:${share * 100}%"></div></div><span class="group-value">${formatStudyMinutes(minutes)}</span></div>`);
  renderAllocation("#plan-content-summary", payload.summary.content_minutes, diagnosticContents, (key, minutes, share) => `
    <div class="allocation-row"><span>${escapeHtml(contentLabels[key])}</span><div class="progress-track"><div class="progress-fill" style="width:${share * 100}%"></div></div><strong>${formatStudyMinutes(minutes)}</strong></div>`);
  const weeks = planCalendarWeeks(run, payload.items);
  if (!weeks.length) return;
  if (state.planWeekRunId !== run.id) {
    const today = localDayIso(new Date());
    const currentWeek = weeks.findIndex((week) => week.days.some((day) => day.date === today));
    state.planWeekRunId = run.id;
    state.planWeekIndex = currentWeek >= 0 ? currentWeek : 0;
  }
  state.planWeekIndex = Math.min(Math.max(Number(state.planWeekIndex) || 0, 0), weeks.length - 1);
  const selectedWeek = weeks[state.planWeekIndex];
  const previous = state.planWeekIndex - 1;
  const next = state.planWeekIndex + 1;
  $("#plan-week-navigation").innerHTML = `
    <section class="plan-week-panel" aria-label="Navegação entre as semanas do cronograma">
      <div class="plan-week-heading">
        <button class="week-arrow" type="button" data-plan-week="${previous}" ${previous < 0 ? "disabled" : ""} aria-label="Semana anterior">←</button>
        <div><span class="eyebrow">Semana selecionada</span><h2>Semana ${selectedWeek.number}</h2><small>${weekPeriodLabel(selectedWeek)} · ${selectedWeek.entries} bloco${selectedWeek.entries === 1 ? "" : "s"} · ${formatStudyMinutes(selectedWeek.minutes)}</small></div>
        <button class="week-arrow" type="button" data-plan-week="${next}" ${next >= weeks.length ? "disabled" : ""} aria-label="Próxima semana">→</button>
      </div>
      <div class="plan-week-tabs" role="tablist" aria-label="Semanas do ciclo">
        ${weeks.map((week, index) => `<button class="plan-week-tab ${index === state.planWeekIndex ? "is-active" : ""}" type="button" role="tab" aria-selected="${index === state.planWeekIndex}" data-plan-week="${index}">Sem ${week.number}<small>${week.completed}/${week.entries}</small></button>`).join("")}
      </div>
    </section>`;
  $("#plan-days").innerHTML = selectedWeek.days.map((day) => {
    const items = day.items;
    const minutes = items.reduce((sum, item) => sum + item.duration_minutes, 0);
    const completed = items.length > 0 && items.every((item) => item.status === "CONCLUIDO");
    return `
      <section class="plan-day ${completed ? "is-complete" : ""}">
        <div class="plan-day-heading">
          <div><h2>${weekdayName(day.date)}</h2><span>${formatLocalDate(day.date)}</span></div>
          <span class="plan-day-load">${items.length ? `${items.length} bloco${items.length === 1 ? "" : "s"} · ${formatStudyMinutes(minutes)}` : "Sem carga programada"}</span>
        </div>
        ${items.length
          ? `<div class="plan-entry-list">${items.map(planEntryCard).join("")}</div>`
          : `<div class="plan-day-empty"><strong>Dia livre no diagnóstico</strong><span>Não há bloco de estudo previsto para esta data.</span></div>`}
      </section>`;
  }).join("");
}

async function loadPlan() {
  try {
    state.plan = await api("/api/planning");
    renderPlan();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function generatePlan() {
  if (state.plan?.run && !confirm("Gerar um novo ciclo substituirá o cronograma ativo. O histórico continuará preservado. Continuar?")) return;
  const button = $("#generate-plan");
  button.disabled = true;
  try {
    state.plan = await api("/api/planning/generate", { method: "POST", body: "{}" });
    renderPlan();
    toast("Novo ciclo de estudos gerado.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function updatePlanEntry(button) {
  button.disabled = true;
  try {
    await api(`/api/planning/entries/${encodeURIComponent(button.dataset.planEntry)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.planStatus }),
    });
    await Promise.all([loadPlan(), loadDashboard()]);
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
}

function reviewCard(item) {
  return `
    <article class="review-card">
      <div class="review-date"><span>Próxima revisão</span><strong>${formatLocalDate(item.due_date)}</strong><small>${item.interval_days ? `intervalo atual: ${item.interval_days} dia(s)` : "primeira revisão"}</small></div>
      <div class="review-body"><div class="question-card-meta"><span class="court-pill">Grupo ${escapeHtml(item.objective_group)}</span><span>${escapeHtml(item.discipline_name)}</span><span>domínio ${item.mastery ?? "—"}</span></div><h3>${escapeHtml(item.title)}</h3></div>
      <div class="review-actions" data-review-topic="${escapeHtml(item.topic_id)}">
        <button class="review-rate repeat" data-review-rating="REPETIR">Repetir</button><button class="review-rate difficult" data-review-rating="DIFICIL">Difícil</button><button class="review-rate good" data-review-rating="BOM">Bom</button><button class="review-rate easy" data-review-rating="FACIL">Fácil</button>
      </div>
    </article>`;
}

async function loadReviews() {
  try {
    const scope = $("#review-scope").value;
    const payload = await api(`/api/reviews?scope=${scope}`);
    state.reviews = payload.items;
    $("#review-due-count").textContent = payload.due;
    $("#review-list").innerHTML = payload.items.length ? payload.items.map(reviewCard).join("") : `<div class="empty-state"><strong>Nenhuma revisão nesta seleção</strong>Tópicos iniciados aparecerão automaticamente na fila.</div>`;
  } catch (error) {
    toast(error.message, "error");
  }
}

async function rateReview(button) {
  const container = button.closest("[data-review-topic]");
  $$('button', container).forEach((element) => { element.disabled = true; });
  try {
    await api(`/api/reviews/${encodeURIComponent(container.dataset.reviewTopic)}/rate`, {
      method: "POST",
      body: JSON.stringify({ rating: button.dataset.reviewRating }),
    });
    toast("Revisão registrada e próxima data recalculada.");
    await Promise.all([loadReviews(), loadProgram(), loadDashboard()]);
  } catch (error) {
    toast(error.message, "error");
    $$('button', container).forEach((element) => { element.disabled = false; });
  }
}

function discursivePromptCard(item) {
  return `
    <button class="discursive-prompt-card" data-open-prompt="${escapeHtml(item.id)}">
      <div class="question-card-meta"><span class="court-pill">Grupo ${escapeHtml(item.objective_group || "—")}</span>${item.authorship_type === "IA" ? `<span class="ai-pill">Autoral assistido por IA</span>` : `<span>Tema próprio</span>`}</div>
      <strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.discipline_name || "Tema interdisciplinar")} · ${item.attempt_count} tentativa(s)</small>
    </button>`;
}

function discursiveHistoryRow(item) {
  return `<button class="discursive-history-row" data-open-attempt="${escapeHtml(item.id)}" data-open-prompt="${escapeHtml(item.prompt_id)}"><span><strong>${escapeHtml(item.prompt_title)}</strong><small>${formatDate(item.updated_at, true)} · ${item.word_count} palavras</small></span><span class="status-pill ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></button>`;
}

async function loadDiscursives() {
  try {
    const [prompts, attempts] = await Promise.all([api("/api/discursive-prompts"), api("/api/discursive-attempts")]);
    state.discursivePrompts = prompts.items;
    state.discursiveAttempts = attempts.items;
    $("#discursive-prompt-list").innerHTML = prompts.items.map(discursivePromptCard).join("");
    $("#discursive-history").innerHTML = attempts.items.length ? attempts.items.map(discursiveHistoryRow).join("") : `<div class="empty-state compact-empty"><strong>Nenhuma resposta salva</strong>O primeiro rascunho aparecerá aqui.</div>`;
    if (state.activeDiscursivePrompt) openDiscursivePrompt(state.activeDiscursivePrompt.id, state.activeDiscursiveAttempt?.id);
  } catch (error) {
    toast(error.message, "error");
  }
}

function openDiscursivePrompt(promptId, attemptId = null) {
  const prompt = state.discursivePrompts.find((item) => item.id === promptId);
  if (!prompt) return;
  const attempt = attemptId
    ? state.discursiveAttempts.find((item) => item.id === attemptId)
    : state.discursiveAttempts.find((item) => item.prompt_id === promptId && item.status === "RASCUNHO");
  state.activeDiscursivePrompt = prompt;
  state.activeDiscursiveAttempt = attempt || null;
  $("#discursive-editor-empty").hidden = true;
  $("#discursive-attempt-form").hidden = false;
  $("#discursive-attempt-form").classList.remove("hidden");
  $("#attempt-id").value = attempt?.id || "";
  $("#attempt-prompt-id").value = prompt.id;
  $("#attempt-meta").textContent = `Grupo ${prompt.objective_group || "—"} · ${prompt.discipline_name || "interdisciplinar"}${prompt.authorship_type === "IA" ? " · AUTORAL ASSISTIDO POR IA" : ""}`;
  $("#attempt-title").textContent = prompt.title;
  $("#attempt-prompt-text").textContent = prompt.prompt_text;
  $("#attempt-source").innerHTML = prompt.source_url ? `<div class="ai-source-notice"><strong>${escapeHtml(prompt.official_reference || "Repertório indicado")}</strong><a href="${escapeHtml(prompt.source_url)}" target="_blank" rel="noreferrer">Abrir repertório normativo</a></div>` : "";
  $("#attempt-answer").value = attempt?.answer_text || "";
  $("#attempt-time").value = attempt?.elapsed_minutes || 0;
  $("#attempt-score").value = attempt?.self_score ?? "";
  $("#attempt-strengths").value = attempt?.strengths || "";
  $("#attempt-improvements").value = attempt?.improvements || "";
  updateAttemptWordCount();
}

function updateAttemptWordCount() {
  const words = ($("#attempt-answer").value.match(/\b[\wÀ-ÿ]+(?:[-'][\wÀ-ÿ]+)*\b/g) || []).length;
  $("#attempt-word-count").textContent = `${words} palavra${words === 1 ? "" : "s"}`;
}

async function saveDiscursiveAttempt(event) {
  event.preventDefault();
  const submitter = event.submitter || event.currentTarget.querySelector("button[type='submit']");
  const status = submitter?.dataset.attemptStatus || "RASCUNHO";
  if (submitter) submitter.disabled = true;
  try {
    const result = await api("/api/discursive-attempts", {
      method: "POST",
      body: JSON.stringify({
        id: $("#attempt-id").value || null,
        prompt_id: $("#attempt-prompt-id").value,
        answer_text: $("#attempt-answer").value,
        elapsed_minutes: Number($("#attempt-time").value || 0),
        self_score: $("#attempt-score").value || null,
        strengths: $("#attempt-strengths").value,
        improvements: $("#attempt-improvements").value,
        status,
      }),
    });
    $("#attempt-id").value = result.id;
    state.activeDiscursiveAttempt = result;
    toast(status === "CONCLUIDA" ? "Resposta concluída." : "Rascunho salvo.");
    await loadDiscursives();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    if (submitter) submitter.disabled = false;
  }
}

async function createDiscursivePrompt(event) {
  event.preventDefault();
  try {
    await api("/api/discursive-prompts", {
      method: "POST",
      body: JSON.stringify({
        title: $("#new-prompt-title").value.trim(),
        prompt_text: $("#new-prompt-text").value.trim(),
        objective_group: $("#new-prompt-group").value || null,
        discipline_code: $("#new-prompt-discipline").value || null,
        official_reference: $("#new-prompt-reference").value.trim(),
        source_url: $("#new-prompt-source").value.trim(),
      }),
    });
    event.target.reset();
    event.target.hidden = true;
    toast("Tema discursivo cadastrado.");
    await loadDiscursives();
  } catch (error) {
    toast(error.message, "error");
  }
}

function questionSourceCard(source) {
  return `
    <article class="question-source-card">
      <div>
        <span class="eyebrow">${escapeHtml(source.institution)} · ${source.year || "s/ano"}</span>
        <strong>${escapeHtml(source.contest)}</strong>
        <small>${escapeHtml(source.document_title)} · ${escapeHtml(source.document_kind)}</small>
      </div>
      <div class="question-source-status">
        <span>${source.question_count} questão(ões)</span>
        <a href="${escapeHtml(source.source_url)}" target="_blank" rel="noreferrer">Abrir fonte</a>
      </div>
    </article>`;
}

function questionCard(item) {
  const options = item.options
    .map((option) => `<li><span>${escapeHtml(option.key)}</span>${escapeHtml(option.text)}</li>`)
    .join("");
  return `
    <article class="question-bank-card">
      <div class="question-card-meta">
        <span class="court-pill">Grupo ${escapeHtml(item.objective_group)}</span>
        <span>${escapeHtml(item.discipline_name)}</span>
        ${item.authorship_type === "IA" ? `<span class="ai-pill">Autoral assistida por IA</span>` : `<span>Fonte vinculada</span>`}
      </div>
      <h3>${escapeHtml(item.stem)}</h3>
      <ol class="question-option-preview">${options}</ol>
      ${item.authorship_type === "IA" && item.source_url ? `<div class="ai-source-notice"><strong>${escapeHtml(item.official_reference || "Referência oficial")}</strong><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">Abrir referência</a></div>` : ""}
      <div class="question-card-footer">
        <small>${escapeHtml(item.id)}${item.topic_ids.length ? ` · ${item.topic_ids.map(escapeHtml).join(", ")}` : ""}${item.open_report_count ? " · sinalização ativa" : ""}</small>
        <div class="question-card-actions">
          <button class="button button-secondary" data-report-question="${escapeHtml(item.id)}" ${item.open_report_count ? "disabled" : ""}>
            ${item.open_report_count ? "Problema informado" : "Informar problema"}
          </button>
          <button class="button button-primary" data-practice-question="${escapeHtml(item.id)}">Praticar esta questão</button>
        </div>
      </div>
    </article>`;
}

function aiSourceNotice(item) {
  const link = item.source_url
    ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">Conferir fonte oficial</a>`
    : "Fonte oficial não cadastrada";
  return `
    <div class="ai-source-notice">
      <strong>Conteúdo experimental: gabarito e justificativa ainda não validados.</strong>
      <span>${escapeHtml(item.official_reference || "Referência oficial pendente")}</span>
      ${link}
    </div>`;
}

function renderQuestionStats() {
  const stats = state.questionStats;
  $("#question-stat-eligible").textContent = stats.eligible;
  $("#question-stat-unseen").textContent = stats.unseen;
  $("#question-stat-answered").textContent = stats.answered;
  $("#question-stat-accuracy").textContent = stats.accuracy == null ? "—" : percent(stats.accuracy);
}

async function loadQuestionBank() {
  const requestId = ++state.questionRequest;
  const params = new URLSearchParams();
  const discipline = $("#question-discipline").value;
  const query = $("#question-search").value.trim();
  params.set("ready", "1");
  if (discipline) params.set("discipline", discipline);
  if (query) params.set("q", query);
  $("#question-list").innerHTML = `<div class="loading">Carregando banco de questões…</div>`;
  try {
    const [stats, payload] = await Promise.all([
      api("/api/questions/stats"),
      api(`/api/questions?${params}`),
    ]);
    if (requestId !== state.questionRequest) return;
    state.questionStats = stats;
    state.questions = payload.items;
    renderQuestionStats();
    $("#question-result-count").textContent = `${payload.total} questão${payload.total === 1 ? "" : "ões"}`;
    $("#question-list").innerHTML = payload.items.length
      ? payload.items.map(questionCard).join("")
      : `<div class="empty-state"><strong>Nenhum lote liberado nesta versão</strong>Você não precisa validar conteúdo. O banco aparecerá aqui quando um pacote curado for incorporado.</div>`;
  } catch (error) {
    $("#question-list").innerHTML = `<div class="empty-state"><strong>Falha ao carregar</strong>${escapeHtml(error.message)}</div>`;
  }
}

function renderAvailability() {
  const stats = state.questionStats;
  const ready = stats.eligible > 0;
  const notice = $("#simulator-readiness");
  notice.className = `notice ${ready ? "notice-ok" : "notice-warning"}`;
  notice.innerHTML = ready
    ? `<strong>${stats.eligible} questão(ões) liberada(s), ${stats.unseen} inédita(s).</strong> A seleção usa primeiro os itens menos vistos e só repete quando necessário.`
    : `<strong>Prática bloqueada por insuficiência de conteúdo liberado.</strong> O cronograma redistribui esse tempo automaticamente; não há tarefa de validação para o candidato.`;
  $("#quiz-availability").innerHTML = stats.groups.map((group) => {
    const coverage = Math.min(group.eligible / 25, 1);
    return `
      <article class="availability-card">
        <span>Grupo ${escapeHtml(group.group_name)}</span>
        <strong>${group.eligible}<small>/25</small></strong>
        <div class="progress-track"><div class="progress-fill" style="width:${coverage * 100}%"></div></div>
      </article>`;
  }).join("");
}

function sessionRow(session) {
  const progress = `${session.answered_count}/${session.question_count}`;
  const result = session.status === "FINALIZADO"
    ? session.is_experimental
      ? `${session.correct_count} resposta(s) provisoriamente correta(s) · sem nota`
      : `${session.correct_count} acerto(s) · nota ${Number(session.score_10 || 0).toFixed(1)}`
    : `${progress} respondida(s)`;
  return `
    <button class="quiz-session-row" data-open-session="${escapeHtml(session.id)}">
      <span><strong>${escapeHtml(session.title)}</strong><small>${formatDate(session.created_at, true)}</small></span>
      <span><b>${escapeHtml(session.status)}</b><small>${result}</small></span>
    </button>`;
}

function renderQuizSessions() {
  $("#quiz-session-list").innerHTML = state.quizSessions.length
    ? state.quizSessions.map(sessionRow).join("")
    : `<div class="empty-state compact-empty"><strong>Nenhuma sessão iniciada</strong>O histórico será preservado neste dispositivo.</div>`;
}

function updateQuizForm() {
  const kind = $("#quiz-kind").value;
  const isComplete = kind === "SIMULADO_COMPLETO";
  const isGroup = kind === "SIMULADO_GRUPO";
  $("#quiz-group").disabled = isComplete;
  $("#quiz-discipline").disabled = isComplete || isGroup;
  $("#quiz-count").disabled = isComplete || isGroup;
  if (isComplete) {
    $("#quiz-group").value = "";
    $("#quiz-discipline").value = "";
  }
  const groups = Object.fromEntries((state.questionStats?.groups || []).map((item) => [item.group_name, item.eligible]));
  const selectedGroup = $("#quiz-group").value;
  const available = isComplete
    ? ["I", "II", "III", "IV"].every((group) => (groups[group] || 0) >= 25)
    : isGroup
      ? Boolean(selectedGroup) && (groups[selectedGroup] || 0) >= 25
      : (state.questionStats?.eligible || 0) > 0;
  $("#start-quiz").disabled = !available;
  $("#start-quiz").textContent = available ? "Iniciar sessão" : "Conteúdo ainda insuficiente";
}

async function loadSimulators() {
  try {
    const [stats, sessions] = await Promise.all([
      api("/api/questions/stats"),
      api("/api/quiz-sessions"),
    ]);
    state.questionStats = stats;
    state.quizSessions = sessions.items.filter((item) => !item.is_experimental);
    renderAvailability();
    renderQuizSessions();
    updateQuizForm();
    const savedSession = localStorage.getItem("dpern_active_quiz");
    if (savedSession && state.quizSessions.some((item) => item.id === savedSession) && !state.activeQuiz) {
      await openQuizSession(savedSession, false);
    } else if (savedSession && !state.quizSessions.some((item) => item.id === savedSession)) {
      localStorage.removeItem("dpern_active_quiz");
    }
  } catch (error) {
    $("#active-quiz").innerHTML = `<div class="empty-state"><strong>Falha ao carregar simulados</strong>${escapeHtml(error.message)}</div>`;
  }
}

function quizQuestionCard(item, sessionStatus) {
  const answered = Boolean(item.answered_at);
  if (!answered && !state.quizTimers[item.question_id]) state.quizTimers[item.question_id] = Date.now();
  const options = item.options.map((option) => {
    const correct = answered && option.key === item.correct_option;
    const wrongSelected = answered && option.key === item.selected_option && !correct;
    return `
      <label class="quiz-option ${correct ? "is-correct" : ""} ${wrongSelected ? "is-wrong" : ""}">
        <input type="radio" name="answer-${escapeHtml(item.question_id)}" value="${escapeHtml(option.key)}" ${answered ? "disabled" : ""} ${item.selected_option === option.key ? "checked" : ""} />
        <span>${escapeHtml(option.key)}</span>
        <strong>${escapeHtml(option.text)}</strong>
      </label>`;
  }).join("");
  const result = answered
    ? `<div class="answer-feedback ${item.is_correct ? "is-correct" : "is-wrong"}">
         <strong>${item.is_correct ? "Resposta correta" : `Resposta incorreta · gabarito ${escapeHtml(item.correct_option)}`}</strong>
         <p>${escapeHtml(item.explanation || "A justificativa ainda não foi cadastrada.")}</p>
       </div>`
    : sessionStatus !== "EM_ANDAMENTO" && item.correct_option
      ? `<div class="answer-feedback"><strong>Não respondida · gabarito ${escapeHtml(item.correct_option)}</strong><p>${escapeHtml(item.explanation || "")}</p></div>`
      : "";
  const isAi = item.authorship_type_snapshot === "IA";
  const aiNotice = isAi ? `
    <div class="ai-source-notice quiz-ai-notice">
      <strong>Questão gerada por IA · resultado provisório e fora das métricas.</strong>
      <span>${escapeHtml(item.official_reference_snapshot || "Referência oficial pendente")}</span>
      ${item.source_url_snapshot ? `<a href="${escapeHtml(item.source_url_snapshot)}" target="_blank" rel="noreferrer">Validar na fonte oficial</a>` : ""}
      <button class="text-button report-link" data-report-question="${escapeHtml(item.question_id)}" data-report-session="${escapeHtml(state.activeQuiz?.id || "")}" ${item.open_report_count ? "disabled" : ""}>
        ${item.open_report_count ? "Possível erro já sinalizado" : "Sinalizar possível erro"}
      </button>
    </div>` : "";
  return `
    <article class="quiz-question-card ${isAi ? "is-ai-question" : ""}" id="quiz-question-${item.position}">
      <div class="question-card-meta">
        <span class="court-pill">${item.position}</span>
        <span>Grupo ${escapeHtml(item.objective_group)}</span>
        <span>${escapeHtml(item.discipline_name)}</span>
        ${isAi ? `<span class="ai-pill">Gerada por IA</span><span class="validation-pill">${escapeHtml(item.validation_status_snapshot)}</span>` : ""}
        ${answered ? `<span>${escapeHtml(item.confidence)}</span>` : ""}
      </div>
      <h3>${escapeHtml(item.stem_snapshot)}</h3>
      ${aiNotice}
      <form class="quiz-question-form" data-question-id="${escapeHtml(item.question_id)}">
        <div class="quiz-options">${options}</div>
        ${!answered && sessionStatus === "EM_ANDAMENTO" ? `
          <div class="answer-actions">
            <label><span>Confiança</span><select name="confidence"><option value="CERTEZA">Certeza</option><option value="DUVIDA" selected>Dúvida</option><option value="CHUTE">Chute</option></select></label>
            <button class="button button-primary" type="submit">Responder</button>
          </div>` : ""}
      </form>
      ${result}
    </article>`;
}

function renderActiveQuiz() {
  const session = state.activeQuiz;
  if (!session) {
    $("#active-quiz").innerHTML = "";
    return;
  }
  const completion = session.question_count ? session.answered_count / session.question_count : 0;
  $("#active-quiz").innerHTML = `
    <article class="quiz-session-header">
      <div>
        <span class="eyebrow">${session.is_experimental ? "LABORATÓRIO IA" : escapeHtml(session.session_kind)} · ${escapeHtml(session.status)}</span>
        <h2>${escapeHtml(session.title)}</h2>
        <p>${session.answered_count} de ${session.question_count} respondida(s) · ${session.correct_count} acerto(s)</p>
      </div>
      <div class="quiz-session-score">
        <strong>${session.status === "FINALIZADO" && !session.is_experimental ? Number(session.score_10 || 0).toFixed(1) : percent(completion)}</strong>
        <small>${session.status === "FINALIZADO" && !session.is_experimental ? "nota sobre 10" : session.is_experimental ? "revisão experimental" : "concluído"}</small>
      </div>
      ${session.status === "EM_ANDAMENTO" ? `<button class="button button-danger" id="finish-active-quiz">Encerrar sessão</button>` : ""}
    </article>
    <div class="quiz-progress"><div class="progress-track"><div class="progress-fill" style="width:${completion * 100}%"></div></div></div>
    <div class="quiz-question-list">${session.items.map((item) => quizQuestionCard(item, session.status)).join("")}</div>`;
}

async function openQuizSession(sessionId, showSimulator = true) {
  try {
    state.activeQuiz = await api(`/api/quiz-sessions/${encodeURIComponent(sessionId)}`);
    if (state.activeQuiz.status === "EM_ANDAMENTO") localStorage.setItem("dpern_active_quiz", sessionId);
    else localStorage.removeItem("dpern_active_quiz");
    renderActiveQuiz();
    if (showSimulator) showView("simulados");
  } catch (error) {
    localStorage.removeItem("dpern_active_quiz");
    toast(error.message, "error");
  }
}

async function createQuiz(event) {
  event.preventDefault();
  const button = $("#start-quiz");
  const payload = {
    kind: $("#quiz-kind").value,
    group: $("#quiz-group").value || null,
    discipline: $("#quiz-discipline").value || null,
    question_count: Number($("#quiz-count").value),
  };
  button.disabled = true;
  try {
    state.activeQuiz = await api("/api/quiz-sessions", { method: "POST", body: JSON.stringify(payload) });
    localStorage.setItem("dpern_active_quiz", state.activeQuiz.id);
    renderActiveQuiz();
    await loadSimulators();
    $("#active-quiz").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function startSingleQuestion(questionId) {
  try {
    state.activeQuiz = await api("/api/quiz-sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "PRATICA", question_ids: [questionId] }),
    });
    localStorage.setItem("dpern_active_quiz", state.activeQuiz.id);
    showView("simulados");
    renderActiveQuiz();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function startAiReviewQuestion(questionId) {
  try {
    state.activeQuiz = await api("/api/quiz-sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "LABORATORIO_IA", question_ids: [questionId] }),
    });
    localStorage.setItem("dpern_active_quiz", state.activeQuiz.id);
    showView("simulados");
    renderActiveQuiz();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function answerQuiz(form) {
  const questionId = form.dataset.questionId;
  const selected = $("input[type=radio]:checked", form);
  if (!selected) {
    toast("Selecione uma alternativa antes de responder.", "error");
    return;
  }
  const button = $("button[type=submit]", form);
  button.disabled = true;
  try {
    state.activeQuiz = await api(`/api/quiz-sessions/${encodeURIComponent(state.activeQuiz.id)}/answer`, {
      method: "POST",
      body: JSON.stringify({
        question_id: questionId,
        selected_option: selected.value,
        confidence: $("select[name=confidence]", form).value,
        elapsed_seconds: Math.round((Date.now() - (state.quizTimers[questionId] || Date.now())) / 1000),
      }),
    });
    delete state.quizTimers[questionId];
    if (state.activeQuiz.status !== "EM_ANDAMENTO") localStorage.removeItem("dpern_active_quiz");
    renderActiveQuiz();
    const [stats, sessions] = await Promise.all([api("/api/questions/stats"), api("/api/quiz-sessions")]);
    state.questionStats = stats;
    state.quizSessions = sessions.items.filter((item) => !item.is_experimental);
    renderAvailability();
    renderQuizSessions();
    await loadDashboard();
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
}

async function finishActiveQuiz() {
  if (!state.activeQuiz || !confirm("Encerrar a sessão agora? Questões não respondidas permanecerão em branco.")) return;
  try {
    state.activeQuiz = await api(`/api/quiz-sessions/${encodeURIComponent(state.activeQuiz.id)}/finish`, { method: "POST" });
    localStorage.removeItem("dpern_active_quiz");
    renderActiveQuiz();
    await loadSimulators();
  } catch (error) {
    toast(error.message, "error");
  }
}

function openQuestionReport(questionId, sessionId = "") {
  const dialog = $("#question-report-dialog");
  $("#report-question-id").value = questionId;
  $("#report-session-id").value = sessionId;
  $("#report-category").value = "GABARITO";
  $("#report-description").value = "";
  $("#report-evidence-url").value = "";
  dialog.showModal();
  $("#report-description").focus();
}

function closeQuestionReport() {
  const dialog = $("#question-report-dialog");
  if (dialog.open) dialog.close();
}

async function submitQuestionReport(event) {
  event.preventDefault();
  const questionId = $("#report-question-id").value;
  const button = $("#submit-question-report");
  button.disabled = true;
  try {
    await api(`/api/questions/${encodeURIComponent(questionId)}/reports`, {
      method: "POST",
      body: JSON.stringify({
        session_id: $("#report-session-id").value || null,
        category: $("#report-category").value,
        description: $("#report-description").value.trim(),
        evidence_url: $("#report-evidence-url").value.trim(),
      }),
    });
    closeQuestionReport();
    toast("Possível erro registrado. A questão foi bloqueada para novas sessões locais.");
    if (state.activeQuiz) await openQuizSession(state.activeQuiz.id, false);
    await Promise.all([loadQuestionBank(), loadSimulators()]);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function exportQuestionReports() {
  try {
    const payload = await api("/api/question-reports?limit=300");
    if (!payload.items.length) {
      toast("Não há sinalizações para exportar.", "error");
      return;
    }
    const exported = {
      format: "centro-dpern-question-reports",
      schema_version: 1,
      generated_at: new Date().toISOString(),
      reports: payload.items,
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sinalizacoes-questoes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast(`${payload.items.length} sinalização(ões) exportada(s).`);
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderSourceHealth() {
  $("#juris-source-health").innerHTML = state.sources.map((source) => {
    const status = !source.enabled ? "Desabilitada" : source.last_error ? "Última tentativa falhou" : source.last_success_at ? "Atualizada" : "Ainda não consultada";
    return `
      <article class="source-health-card">
        <span class="eyebrow">${escapeHtml(source.court)} · ${escapeHtml(source.source_kind)}</span>
        <strong>${escapeHtml(source.name)}</strong>
        <small>${escapeHtml(status)}${source.last_success_at ? ` · ${formatDate(source.last_success_at, true)}` : ""}</small>
      </article>`;
  }).join("");
}

function jurisCard(item) {
  const summary = item.summary || "O feed não forneceu resumo. Consulte a fonte oficial.";
  const studyLabels = { NAO_LIDO: "Não lido", REVISAO: "Revisar depois", LIDO: "Lido" };
  return `
    <article class="juris-card ${String(item.study_status).toLowerCase()}">
      <div class="juris-meta">
        <span class="court-pill">${escapeHtml(item.court)}</span>
        <span class="status-pill ${String(item.study_status).toLowerCase()}">${escapeHtml(studyLabels[item.study_status] || item.study_status)}</span>
        ${item.issue_number ? `<span>Informativo ${escapeHtml(item.issue_number)}</span>` : ""}
        <span>${formatDate(item.published_at)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(summary.slice(0, 620))}${summary.length > 620 ? "…" : ""}</p>
      <div class="juris-actions">
        <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">Abrir publicação oficial</a>
        ${item.study_status !== "LIDO" ? `<button class="button button-primary" data-juris-id="${item.id}" data-juris-status="LIDO">Marcar como lido</button>` : ""}
        ${item.study_status !== "REVISAO" ? `<button class="button button-secondary" data-juris-id="${item.id}" data-juris-status="REVISAO">Revisar depois</button>` : ""}
        ${item.study_status !== "NAO_LIDO" ? `<button class="text-button" data-juris-id="${item.id}" data-juris-status="NAO_LIDO">Reabrir</button>` : ""}
      </div>
    </article>`;
}

async function loadJurisprudence() {
  const requestId = ++state.jurisRequest;
  const params = new URLSearchParams();
  const court = $("#juris-court").value;
  const status = $("#juris-status").value;
  const query = $("#juris-search").value.trim();
  if (court) params.set("court", court);
  if (status) params.set("study", status);
  if (query) params.set("q", query);
  $("#juris-list").innerHTML = `<div class="loading">Carregando jurisprudência…</div>`;
  try {
    const [payload, sources] = await Promise.all([api(`/api/jurisprudence?${params}`), api("/api/sources")]);
    if (requestId !== state.jurisRequest) return;
    state.jurisprudence = payload.items;
    state.sources = sources.items;
    renderSourceHealth();
    $("#juris-list").innerHTML = payload.items.length
      ? payload.items.map(jurisCard).join("")
      : `<div class="empty-state"><strong>Nenhuma publicação importada</strong>Use “Buscar atualizações”. Se a máquina estiver offline, o módulo tentará novamente na próxima abertura.</div>`;
  } catch (error) {
    $("#juris-list").innerHTML = `<div class="empty-state"><strong>Falha ao carregar</strong>${escapeHtml(error.message)}</div>`;
  }
}

async function updateJurisprudenceProgress(button) {
  button.disabled = true;
  try {
    await api(`/api/jurisprudence/${encodeURIComponent(button.dataset.jurisId)}`, {
      method: "PATCH",
      body: JSON.stringify({ study_status: button.dataset.jurisStatus }),
    });
    await Promise.all([loadJurisprudence(), loadDashboard()]);
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
}

async function updateJurisprudence() {
  const button = $("#update-jurisprudence");
  button.disabled = true;
  button.textContent = "Consultando fontes…";
  try {
    const result = await api("/api/jurisprudence/update", { method: "POST" });
    const imported = result.sources.reduce((sum, source) => sum + (source.imported || 0), 0);
    const summaries = result.sources.reduce((sum, source) => sum + (source.summaries_updated || 0), 0);
    const failures = result.sources.filter((source) => source.status === "ERRO").length;
    toast(`${imported} publicação(ões) nova(s); ${summaries} síntese(s) incorporada(s) ou reparada(s). ${failures ? `${failures} fonte(s) falharam.` : "Fontes consultadas."}`, failures ? "error" : "success");
    await Promise.all([loadJurisprudence(), loadDashboard()]);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Buscar atualizações";
  }
}

function fillSettings(settings) {
  if (!settings) return;
  $("#candidate-name").value = settings.candidate_name || "";
  $("#target-exam-date").value = settings.target_exam_date || "";
  $("#backup-dir").value = settings.backup_dir || "";
  $("#auto-backup").checked = String(settings.auto_backup) === "true";
  $("#auto-juris").checked = String(settings.jurisprudence_auto_update) === "true";
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = {
    candidate_name: $("#candidate-name").value.trim(),
    target_exam_date: $("#target-exam-date").value || null,
    backup_dir: $("#backup-dir").value.trim(),
    auto_backup: $("#auto-backup").checked,
    jurisprudence_auto_update: $("#auto-juris").checked,
  };
  try {
    const settings = await api("/api/settings", { method: "PATCH", body: JSON.stringify(payload) });
    fillSettings(settings);
    toast("Configurações salvas nesta instalação.");
    await loadDashboard();
  } catch (error) {
    toast(error.message, "error");
  }
}

function bytes(value) {
  return new Intl.NumberFormat("pt-BR", { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 }).format(value / 1024);
}

function backupRow(item) {
  return `
    <div class="backup-row">
      <div><strong>${escapeHtml(item.file_name)}</strong><small>${formatDate(item.modified_at, true)}</small></div>
      <span>${bytes(item.size_bytes)}</span>
      <div class="backup-actions">
        <button class="button button-secondary" data-backup-action="verify" data-file="${escapeHtml(item.file_name)}">Verificar</button>
        <button class="button button-danger" data-backup-action="restore" data-file="${escapeHtml(item.file_name)}">Restaurar</button>
      </div>
    </div>`;
}

async function loadBackups() {
  try {
    const payload = await api("/api/backups");
    state.backups = payload.items;
    $("#backup-list").innerHTML = payload.items.length
      ? payload.items.map(backupRow).join("")
      : `<div class="empty-state"><strong>Nenhum backup criado</strong>Crie o primeiro pacote antes de registrar progresso relevante.</div>`;
  } catch (error) {
    $("#backup-list").innerHTML = `<div class="empty-state"><strong>Falha ao listar backups</strong>${escapeHtml(error.message)}</div>`;
  }
}

async function createBackup(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Criando…";
  try {
    const result = await api("/api/backups", { method: "POST" });
    toast(`Backup verificado: ${result.file_name}`);
    await loadBackups();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function backupAction(button) {
  const operation = button.dataset.backupAction;
  const file = button.dataset.file;
  let body;
  if (operation === "restore") {
    const confirmation = prompt(`A restauração substituirá o progresso atual.\n\nDigite RESTAURAR para usar ${file}:`);
    if (confirmation !== "RESTAURAR") return;
    body = JSON.stringify({ confirmation });
  }
  button.disabled = true;
  try {
    const result = await api(`/api/backups/${encodeURIComponent(file)}/${operation}`, { method: "POST", body });
    toast(operation === "restore" ? `Backup restaurado. Cópia de segurança: ${result.recovery_file}` : `Integridade confirmada: ${file}`);
    if (operation === "restore") await Promise.all([loadDashboard(), loadProgram(), loadQuestionBank(), loadSimulators(), loadJurisprudence()]);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function checkHealth() {
  try {
    await api("/api/health");
    $("#local-status-dot").className = "status-dot is-ok";
    $("#local-status-title").textContent = "Serviço local ativo";
    $("#local-status-detail").textContent = navigator.onLine ? "internet disponível" : "modo offline";
  } catch {
    $("#local-status-dot").className = "status-dot is-error";
    $("#local-status-title").textContent = "Serviço indisponível";
    $("#local-status-detail").textContent = "reinicie a aplicação";
  }
}

function debounce(callback, wait = 280) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), wait);
  };
}

function registerEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.go)));
  $("#mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("#program-discipline").addEventListener("change", loadProgram);
  $("#program-status").addEventListener("change", loadProgram);
  $("#program-search").addEventListener("input", debounce(loadProgram));
  $("#program-list").addEventListener("change", (event) => {
    if (event.target.matches("[data-field]")) updateTopic(event.target);
  });
  $("#question-discipline").addEventListener("change", loadQuestionBank);
  $("#question-search").addEventListener("input", debounce(loadQuestionBank));
  $("#question-list").addEventListener("click", (event) => {
    const practiceButton = event.target.closest("[data-practice-question]");
    const reportButton = event.target.closest("[data-report-question]");
    if (practiceButton) startSingleQuestion(practiceButton.dataset.practiceQuestion);
    else if (reportButton) openQuestionReport(reportButton.dataset.reportQuestion);
  });
  $("#quiz-kind").addEventListener("change", updateQuizForm);
  $("#quiz-group").addEventListener("change", updateQuizForm);
  $("#quiz-form").addEventListener("submit", createQuiz);
  $("#quiz-session-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-session]");
    if (button) openQuizSession(button.dataset.openSession, false);
  });
  $("#active-quiz").addEventListener("submit", (event) => {
    const form = event.target.closest(".quiz-question-form");
    if (form) {
      event.preventDefault();
      answerQuiz(form);
    }
  });
  $("#active-quiz").addEventListener("click", (event) => {
    if (event.target.closest("#finish-active-quiz")) finishActiveQuiz();
    const reportButton = event.target.closest("[data-report-question]");
    if (reportButton) {
      openQuestionReport(reportButton.dataset.reportQuestion, reportButton.dataset.reportSession || "");
    }
  });
  $("#question-report-form").addEventListener("submit", submitQuestionReport);
  $("#close-report-dialog").addEventListener("click", closeQuestionReport);
  $("#cancel-report-dialog").addEventListener("click", closeQuestionReport);
  $("#question-report-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeQuestionReport();
  });
  $("#juris-court").addEventListener("change", loadJurisprudence);
  $("#juris-status").addEventListener("change", loadJurisprudence);
  $("#juris-search").addEventListener("input", debounce(loadJurisprudence));
  $("#update-jurisprudence").addEventListener("click", updateJurisprudence);
  $("#juris-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-juris-id]");
    if (button) updateJurisprudenceProgress(button);
  });
  $("#diagnostic-form").addEventListener("input", updateDiagnosticTotals);
  $("#diagnostic-form").addEventListener("submit", (event) => saveDiagnostic(event, false));
  $("#save-and-generate-plan").addEventListener("click", (event) => saveDiagnostic(event, true));
  $("#generate-plan").addEventListener("click", generatePlan);
  $("#plan-week-navigation").addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-week]");
    if (!button || button.disabled) return;
    state.planWeekIndex = Number(button.dataset.planWeek);
    renderPlan();
    $("#plan-week-navigation").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#plan-days").addEventListener("click", handlePlanAction);
  $("#today-agenda").addEventListener("click", handlePlanAction);
  $("#review-scope").addEventListener("change", loadReviews);
  $("#review-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-rating]");
    if (button) rateReview(button);
  });
  $("#toggle-new-prompt").addEventListener("click", () => {
    const form = $("#new-prompt-form");
    form.hidden = !form.hidden;
    form.classList.toggle("hidden", form.hidden);
  });
  $("#new-prompt-form").addEventListener("submit", createDiscursivePrompt);
  $("#discursive-prompt-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-prompt]");
    if (button) openDiscursivePrompt(button.dataset.openPrompt);
  });
  $("#discursive-history").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-attempt]");
    if (button) openDiscursivePrompt(button.dataset.openPrompt, button.dataset.openAttempt);
  });
  $("#discursive-attempt-form").addEventListener("submit", saveDiscursiveAttempt);
  $("#attempt-answer").addEventListener("input", updateAttemptWordCount);
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#create-backup").addEventListener("click", (event) => createBackup(event.currentTarget));
  $("#quick-backup").addEventListener("click", (event) => createBackup(event.currentTarget));
  $("#refresh-backups").addEventListener("click", loadBackups);
  $("#backup-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-backup-action]");
    if (button) backupAction(button);
  });
  addEventListener("online", checkHealth);
  addEventListener("offline", checkHealth);
}

async function init() {
  registerEvents();
  const initialView = location.hash.replace("#", "") || "dashboard";
  showView(pageInfo[initialView] ? initialView : "dashboard");
  try {
    await Promise.all([checkHealth(), loadDisciplines(), loadDashboard()]);
    if (initialView === "programa") await loadProgram();
    if (initialView === "questoes") await loadQuestionBank();
    if (initialView === "simulados") await loadSimulators();
    if (initialView === "jurisprudencia") await loadJurisprudence();
    if (initialView === "diagnostico") await loadDiagnostic();
    if (initialView === "planejamento") await loadPlan();
    if (initialView === "revisoes") await loadReviews();
    if (initialView === "discursivas") await loadDiscursives();
    if (initialView === "backup") await loadBackups();
  } catch (error) {
    toast(`Não foi possível iniciar: ${error.message}`, "error");
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", init);
