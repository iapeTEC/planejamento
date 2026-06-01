/* =========================
   CONFIG
========================= */

// Tenho que lembrar de mudar, caso necessario.
// Cole aqui a URL do Web App do Google Apps Script (Deploy -> Web app)
const API_URL = "https://script.google.com/macros/s/AKfycbwKhONeOMgPsqNVT48BhjDhwouS5OCAgIUCqOSH-PTA1vElcFitcA9mcwZa8m-gg4vHtQ/exec";
const PLATFORM_CONFIG = window.LESSON_PREP_CONFIG || {};

// A URL do Apps Script tambem pode vir por ?gas= ou por window.GAS_URL.
const _qs = new URLSearchParams(window.location.search);
const GAS_URL = _qs.get("gas") || window.GAS_URL || PLATFORM_CONFIG.gasUrl || API_URL;
const GOOGLE_CLIENT_ID = "";

const WEEKDAYS = [
  { key: "SEG", label: "SEG" },
  { key: "TER", label: "TER" },
  { key: "QUA", label: "QUA" },
  { key: "QUI", label: "QUI" },
  { key: "SEX", label: "SEX" },
];

const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
];

const DEFAULT_CLASSES = [
  "Infantil 3",
  "Infantil 4",
  "Infantil 5",
  "1º Ano",
  "2º Ano",
  "3º Ano",
  "4º Ano",
  "5º Ano",
];

/* =========================
   STATE
========================= */
const state = {
  term: "",
  className: "", // ✅ NOVO
  teacher: "",
  teacherId: "",
  teacherEmail: "",
  allowedClasses: [],
  isEnglishTeacher: false,
  teacherProfileLoaded: false,
  calendarEvents: [],
  weekStart: null, // Date object (Mon)
  weekLabel: "(26 a 30 de Janeiro)",
  dateText: "",
  rows: [],
  coordMessage: "",
  isViewMode: document.body.classList.contains("view-mode"),
  idToken: sessionStorage.getItem("lessonPrepIdToken") || "",
  googleUser: null,
  authReady: false,
};

/* =========================
   HELPERS
========================= */
function pad2(n){ return String(n).padStart(2,"0"); }

function toISODate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function fromISODate(s){
  const [y,m,dd] = s.split("-").map(Number);
  return new Date(y, m-1, dd);
}

function mondayOf(date){
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun, 1 Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function businessWeeksOfMonth(year, monthIndex){
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const weeks = [];

  let cursor = mondayOf(first);

  while(cursor <= last){
    const mon = new Date(cursor);
    const fri = new Date(cursor);
    fri.setDate(fri.getDate() + 4);

    const anyInside =
      (mon.getMonth() === monthIndex) ||
      (new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()+1).getMonth() === monthIndex) ||
      (new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()+2).getMonth() === monthIndex) ||
      (new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()+3).getMonth() === monthIndex) ||
      (fri.getMonth() === monthIndex);

    if(anyInside){
      const label = `(${mon.getDate()} a ${fri.getDate()} de ${MONTHS_PT[monthIndex]})`;
      weeks.push({ weekStart: mon, label });
    }

    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function getQueryParams(){
  const p = new URLSearchParams(window.location.search);
  return Object.fromEntries(p.entries());
}

function setQueryParams(obj){
  const url = new URL(window.location.href);
  Object.entries(obj).forEach(([k,v]) => {
    if(v === null || v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  });
  window.history.replaceState({}, "", url.toString());
}

function defaultWeekIfNone(){
  const today = new Date();
  return mondayOf(today);
}

function sanitizeKeyPart(s){
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function decodeJwtPayload(token){
  try{
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  }catch(_){
    return null;
  }
}

function getUserEmail(){
  return getTeacherId();
}

function getTeacherId(){
  return String(state.teacherId || state.teacherEmail || "").trim().toLowerCase();
}

function splitClasses(value){
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAvailableClasses(){
  if(state.allowedClasses.length) return state.allowedClasses;
  return DEFAULT_CLASSES;
}

function updateHeaderImage(){
  const img = document.getElementById("headerImage");
  if(!img) return;
  img.style.display = "";
  const nextSrc = state.isEnglishTeacher ? "assets/header.png" : "assets/cabecalho.png";
  if(!img.src.endsWith(nextSrc)) img.src = nextSrc;
}

function applyTeacherProfile(profile){
  if(!profile) throw new Error("Perfil do professor não carregado.");
  const teacher = profile.teacher || null;
  if(!teacher) throw new Error("Professor não cadastrado.");

  state.teacherEmail = teacher.email || state.teacherEmail;
  state.teacherId = teacher.teacherId || teacher.email || state.teacherId;
  state.teacher = teacher.name || state.teacher || teacher.email || "";
  state.allowedClasses = splitClasses(teacher.classes);
  state.isEnglishTeacher = Boolean(teacher.isEnglishTeacher);
  state.teacherProfileLoaded = true;

  if(!state.allowedClasses.length) {
    throw new Error("Nenhuma turma cadastrada para este professor.");
  }

  const available = getAvailableClasses();
  if(!available.includes(state.className)){
    state.className = available[0];
  }

  setQueryParams({
    term: state.term,
    week: toISODate(state.weekStart),
    class: state.className,
    teacherId: state.teacherId,
  });

  updateHeaderImage();
  updateClassPickerOptions();
  hydrateUI();
}

function updateClassPickerOptions(){
  const classSelect = document.getElementById("classSelect");
  if(!classSelect) return;

  const availableClasses = getAvailableClasses();
  classSelect.innerHTML = "";
  availableClasses.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    classSelect.appendChild(opt);
  });
  classSelect.value = state.className;
  updateClassControls();
}

function updateClassControls(){
  const availableClasses = getAvailableClasses();
  const disabled = state.isViewMode || availableClasses.length <= 1;

  ["classBtn", "prevClassBtn", "nextClassBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if(!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle("pill-static", disabled);
    btn.setAttribute("aria-disabled", disabled ? "true" : "false");
  });
}

/* =========================
   RENDER TABLE
========================= */
function buildInitialRows(weekStart){
  const rows = WEEKDAYS.map((w, idx) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + idx);
    return {
      date: toISODate(d),
      weekday: w.label,
      dayNum: d.getDate(),
      unitDay: "",
      conteudo: "",
      desenvolvimento: "",
      materiais: "",
      localRecess: false,
      observations: {},
    };
  });
  return rows;
}

function normalizeRow(row){
  return {
    date: row.date || "",
    weekday: row.weekday || "",
    dayNum: row.dayNum || "",
    unitDay: row.unitDay || "",
    conteudo: row.conteudo || "",
    desenvolvimento: row.desenvolvimento || "",
    materiais: row.materiais || "",
    localRecess: Boolean(row.localRecess),
    observations: row.observations && typeof row.observations === "object" ? row.observations : {},
  };
}

function lessonFields(){
  return ["unitDay", "conteudo", "desenvolvimento", "materiais"];
}

function eventsForDate(date){
  return state.calendarEvents.filter((event) => event.date === date);
}

function fixedEventsForDate(date){
  return eventsForDate(date).filter((event) => !event.isObservation);
}

function observationEventsForDate(date){
  return eventsForDate(date).filter((event) => event.isObservation);
}

function isFixedRow(row){
  return Boolean(row.localRecess) || fixedEventsForDate(row.date).length > 0;
}

function toggleLocalRecess(index){
  if(state.isViewMode) return;
  const row = state.rows[index];
  if(!row) return;
  row.localRecess = !row.localRecess;
  if(row.localRecess){
    lessonFields().forEach((field) => row[field] = "");
    row.conteudo = "Recesso";
  }else if(row.conteudo === "Recesso"){
    row.conteudo = "";
  }
  hydrateUI();
  saveToBackend({ silent: true });
}

function movePlanning(direction){
  const movable = state.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isFixedRow(row));

  if(movable.length < 2){
    toast("Não há dias livres suficientes para mover.");
    return;
  }

  const snapshots = movable.map(({ row }) => {
    const copy = {};
    lessonFields().forEach((field) => copy[field] = row[field] || "");
    return copy;
  });

  movable.forEach(({ row }, position) => {
    const source = direction > 0
      ? (position - 1 + snapshots.length) % snapshots.length
      : (position + 1) % snapshots.length;
    lessonFields().forEach((field) => row[field] = snapshots[source][field]);
  });

  hydrateUI();
  saveToBackend({ silent: true });
}

function renderRows(){
  const rowsEl = document.getElementById("rows");
  if(!rowsEl) return;

  rowsEl.innerHTML = "";

  state.rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const fixedEvents = fixedEventsForDate(r.date);
    const observationEvents = observationEventsForDate(r.date);
    const rowFixed = isFixedRow(r);
    if(rowFixed) tr.classList.add("row-recess");

    // ✅ COL 1: Unit, Day
    const tdUnit = document.createElement("td");
    tdUnit.className = "td-unit";

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "day-badge";
    badge.title = "Marcar/desmarcar recesso";
    if(!state.isViewMode) badge.addEventListener("click", () => toggleLocalRecess(idx));

    const dayNum = document.createElement("div");
    dayNum.className = "dayNum";
    dayNum.textContent = r.dayNum;

    const weekPill = document.createElement("div");
    weekPill.className = "weekPill";
    weekPill.textContent = r.weekday;

    badge.appendChild(dayNum);
    badge.appendChild(weekPill);

    const unitText = document.createElement("div");
    unitText.className = "rich";
    unitText.dataset.field = "unitDay";
    unitText.dataset.index = idx;
    unitText.innerHTML = r.unitDay || "";
    if(!state.isViewMode && !rowFixed) unitText.contentEditable = "true";

    tdUnit.appendChild(badge);
    tdUnit.appendChild(unitText);

    // ✅ COL 2
    const td2 = document.createElement("td");
    if(fixedEvents.length || observationEvents.length){
      const eventsBox = document.createElement("div");
      eventsBox.className = "row-events";
      fixedEvents.forEach((event) => {
        const eventEl = document.createElement("div");
        eventEl.className = "row-event row-event-fixed";
        eventEl.style.backgroundColor = event.color || "#dff4df";
        eventEl.innerHTML = `<strong>${event.title || ""}</strong><div>${event.html || ""}</div>`;
        eventsBox.appendChild(eventEl);
      });
      observationEvents.forEach((event) => {
        const eventEl = document.createElement("div");
        eventEl.className = "row-event row-event-observation";
        eventEl.style.backgroundColor = event.color || "#fff4c2";
        const current = r.observations?.[event.eventId] || event.html || event.title || "";
        eventEl.innerHTML = `<strong>${event.title || ""}</strong>`;
        const editable = document.createElement("div");
        editable.className = "rich observation-rich";
        editable.dataset.index = idx;
        editable.dataset.observationId = event.eventId;
        editable.innerHTML = current;
        if(!state.isViewMode) editable.contentEditable = "true";
        eventEl.appendChild(editable);
        eventsBox.appendChild(eventEl);
      });
      td2.appendChild(eventsBox);
    }
    const conteudo = document.createElement("div");
    conteudo.className = "rich";
    conteudo.dataset.field = "conteudo";
    conteudo.dataset.index = idx;
    conteudo.innerHTML = r.conteudo || "";
    if(!state.isViewMode && !rowFixed) conteudo.contentEditable = "true";
    td2.appendChild(conteudo);

    // ✅ COL 3
    const td3 = document.createElement("td");
    const des = document.createElement("div");
    des.className = "rich";
    des.dataset.field = "desenvolvimento";
    des.dataset.index = idx;
    des.innerHTML = r.desenvolvimento || "";
    if(!state.isViewMode && !rowFixed) des.contentEditable = "true";
    td3.appendChild(des);

    // ✅ COL 4
    const td4 = document.createElement("td");
    const mat = document.createElement("div");
    mat.className = "rich";
    mat.dataset.field = "materiais";
    mat.dataset.index = idx;
    mat.innerHTML = r.materiais || "";
    if(!state.isViewMode && !rowFixed) mat.contentEditable = "true";
    td4.appendChild(mat);

    tr.appendChild(tdUnit);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);

    rowsEl.appendChild(tr);
  });

  hookEditListeners();
}

/* =========================
   EDIT LISTENERS
========================= */
function hookEditListeners(){
  if(state.isViewMode) return;

  document.querySelectorAll(".rich[contenteditable='true'][data-field]").forEach(el => {
    if(el.dataset.editBound === "true") return;
    el.dataset.editBound = "true";

    el.addEventListener("input", () => {
      const idx = Number(el.dataset.index);
      const field = el.dataset.field;
      if(Number.isFinite(idx) && field){
        state.rows[idx][field] = el.innerHTML;
      }
    });

    // ✅ mostra sempre no focus
    el.addEventListener("focus", () => showToolbar());
    el.addEventListener("blur", () => saveToBackend({ silent: true }));
  });

  document.querySelectorAll(".observation-rich[contenteditable='true']").forEach(el => {
    if(el.dataset.editBound === "true") return;
    el.dataset.editBound = "true";

    el.addEventListener("input", () => {
      const idx = Number(el.dataset.index);
      const eventId = el.dataset.observationId;
      if(Number.isFinite(idx) && eventId){
        if(!state.rows[idx].observations) state.rows[idx].observations = {};
        state.rows[idx].observations[eventId] = el.innerHTML;
      }
    });
    el.addEventListener("focus", () => showToolbar());
    el.addEventListener("blur", () => saveToBackend({ silent: true }));
  });

  // COORD MESSAGE
  const coord = document.getElementById("coordMessage");
  if(coord && coord.getAttribute("contenteditable") === "true" && coord.dataset.coordBound !== "true"){
    coord.dataset.coordBound = "true";
    coord.addEventListener("focus", () => showToolbar());
    coord.addEventListener("input", () => {
      state.coordMessage = coord.innerHTML;
    });
    coord.addEventListener("blur", () => saveToBackend({ silent: true }));
  }

  // DATE FIELD
  const dateField = document.getElementById("dateField");
  if(dateField && dateField.getAttribute("contenteditable") === "true" && dateField.dataset.dateBound !== "true"){
    dateField.dataset.dateBound = "true";
    dateField.addEventListener("focus", () => showToolbar());
    dateField.addEventListener("input", () => {
      state.dateText = dateField.innerText.trim();
    });
    dateField.addEventListener("blur", () => saveToBackend({ silent: true }));
  }
}

/* =========================
   TOOLBAR
========================= */
function showToolbar(){
  const tb = document.getElementById("toolbar");
  if(!tb) return;
  tb.classList.add("show");
  tb.setAttribute("aria-hidden","false");
}

function hideToolbar(){
  const tb = document.getElementById("toolbar");
  if(!tb) return;
  tb.classList.remove("show");
  tb.setAttribute("aria-hidden","true");
}

function initToolbar(){
  const tb = document.getElementById("toolbar");
  if(!tb) return;

  tb.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  tb.querySelectorAll("[data-cmd]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });

  tb.querySelectorAll("[data-align]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.execCommand(btn.dataset.align, false, null);
    });
  });

  const cp = document.getElementById("colorPicker");
  if(cp){
    cp.addEventListener("input", () => {
      document.execCommand("foreColor", false, cp.value);
    });
  }
}

/* =========================
   GOOGLE AUTH
========================= */
function renderAuthBar(){
  const authBar = document.getElementById("authBar");
  if(!authBar) return;
  authBar.innerHTML = "";
  document.body.classList.remove("app-locked");
  state.authReady = true;
}

function initAuth(){
  renderAuthBar();
}


/* =========================
  Toolbar auto hide
========================= */

function initToolbarAutoHide(){
  document.addEventListener("pointerdown", (e) => {
    const tb = document.getElementById("toolbar");
    if(!tb) return;

    const clickedToolbar = tb.contains(e.target);
    const clickedRich = e.target.closest?.(".rich");

    // ✅ se clicou no toolbar ou em um campo rich -> NÃO esconde
    if(clickedToolbar || clickedRich) return;

    // ✅ clicou fora -> esconde
    hideToolbar();
  });
}


/* =========================
   MODALS
========================= */
function openModal(modalId){
  const m = document.getElementById(modalId);
  if(!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden","false");
}

function closeModal(modalId){
  const m = document.getElementById(modalId);
  if(!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden","true");
}

/* =========================
   CLASS PICKER ✅ NOVO
========================= */
function initClassPicker(){
  const classBtn = document.getElementById("classBtn");
  const classSelect = document.getElementById("classSelect");
  if(!classBtn || !classSelect) return;

  updateClassPickerOptions();

  const classLabel = document.getElementById("classLabel");
  if(classLabel) classLabel.textContent = `Turma: ${state.className}`;
  updateClassControls();

  if(state.isViewMode) return;

  classBtn.addEventListener("click", () => {
    if(getAvailableClasses().length <= 1) {
      toast("Turma fixa conforme cadastro.");
      return;
    }
    openModal("classModal");
  });

  document.getElementById("closeClassModal")?.addEventListener("click", () => closeModal("classModal"));

  document.getElementById("applyClass")?.addEventListener("click", async () => {
    const selected = classSelect.value || getAvailableClasses()[0];
    await setClass(selected);
    closeModal("classModal");
  });

  document.getElementById("prevClassBtn")?.addEventListener("click", () => cycleClass(-1));
  document.getElementById("nextClassBtn")?.addEventListener("click", () => cycleClass(1));
}

async function setClass(newClass){
  const availableClasses = getAvailableClasses();
  if(!availableClasses.includes(newClass)){
    toast("Turma não cadastrada para este professor.");
    updateClassPickerOptions();
    return;
  }

  state.className = newClass;

  const classLabel = document.getElementById("classLabel");
  if(classLabel) classLabel.textContent = `Turma: ${state.className}`;
  updateClassControls();

  // ✅ Atualiza URL (term + week + class)
  setQueryParams({
    term: state.term,
    week: toISODate(state.weekStart),
    class: state.className,
    teacherId: state.teacherId,
  });

  // ✅ MUITO IMPORTANTE:
  // ao trocar de turma, já limpa tudo IMEDIATAMENTE pra lançar
  state.rows = buildInitialRows(state.weekStart);
  state.coordMessage = ""; // (opcional, mas recomendado por turma)

  // mostra em branco na hora
  hydrateUI();

  // depois tenta buscar se existe algo salvo pra essa turma
  await loadFromBackend();
}

async function cycleClass(direction){
  const availableClasses = getAvailableClasses();
  if(availableClasses.length <= 1) {
    toast("Turma fixa conforme cadastro.");
    return;
  }

  const currentIndex = Math.max(0, availableClasses.indexOf(state.className));
  const nextIndex = (currentIndex + direction + availableClasses.length) % availableClasses.length;
  await setClass(availableClasses[nextIndex]);
}


/* =========================
   WEEK + TERM PICKERS
========================= */
function initWeekPicker(){
  const weekBtn = document.getElementById("weekBtn");
  const weekModal = document.getElementById("weekModal");
  const monthSelect = document.getElementById("monthSelect");
  const weekSelect = document.getElementById("weekSelect");

  if(!weekBtn || !weekModal || !monthSelect || !weekSelect) return;
  if(state.isViewMode) return;

  const now = new Date();
  for(let i=0; i<12; i++){
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = MONTHS_PT[i];
    monthSelect.appendChild(opt);
  }
  monthSelect.value = String(now.getMonth());

  function refreshWeeks(){
    const year = now.getFullYear();
    const m = Number(monthSelect.value);
    const weeks = businessWeeksOfMonth(year, m);
    weekSelect.innerHTML = "";
    weeks.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = toISODate(w.weekStart);
      opt.textContent = w.label;
      weekSelect.appendChild(opt);
    });
  }

  monthSelect.addEventListener("change", refreshWeeks);
  refreshWeeks();

  weekBtn.addEventListener("click", () => openModal("weekModal"));

  document.getElementById("closeModal")?.addEventListener("click", () => closeModal("weekModal"));

  document.getElementById("applyWeek")?.addEventListener("click", async () => {
    const iso = weekSelect.value;
    const newMon = fromISODate(iso);
    await setWeek(newMon);
    closeModal("weekModal");
  });
}

function initTermPicker(){
  const termBtn = document.getElementById("termBtn");
  const termModal = document.getElementById("termModal");

  if(!termBtn || !termModal) return;
  if(state.isViewMode) return;

  termBtn.addEventListener("click", () => openModal("termModal"));
  document.getElementById("closeTermModal")?.addEventListener("click", () => closeModal("termModal"));

  document.getElementById("shiftForward")?.addEventListener("click", () => {
    movePlanning(1);
    closeModal("termModal");
  });

  document.getElementById("shiftBackward")?.addEventListener("click", () => {
    movePlanning(-1);
    closeModal("termModal");
  });
}

/* =========================
   Setas grandes de calendario
========================= */

function initWeekArrows(){
  const prevBtn = document.getElementById("prevWeekBtn");
  const nextBtn = document.getElementById("nextWeekBtn");

  if(!prevBtn || !nextBtn) return;

  prevBtn.addEventListener("click", async () => {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() - 7);
    await setWeek(d);
  });

  nextBtn.addEventListener("click", async () => {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() + 7);
    await setWeek(d);
  });
}


/* =========================
   BACKEND (load/save)
========================= */

function makeKey(){
  return `${toISODate(state.weekStart)}_${sanitizeKeyPart(state.className)}`;
}

function buildLessonPayload(){
  return {
    term: state.term,
    className: state.className,
    teacher: state.teacher,
    teacherId: getTeacherId(),
    teacherEmail: getTeacherId(),
    weekStart: toISODate(state.weekStart),
    weekLabel: state.weekLabel,
    dateText: state.dateText,
    rows: state.rows,
    coordMessage: state.coordMessage,
    isEnglishTeacher: state.isEnglishTeacher,
  };
}

function applyLessonPayload(payload){
  if(!payload) return;

  state.term = payload.term || state.term;
  state.className = payload.className || state.className;
  state.teacherId = payload.teacherId || payload.teacherEmail || state.teacherId;
  state.teacherEmail = state.teacherId;
  state.isEnglishTeacher = Boolean(state.isEnglishTeacher);
  state.weekLabel = payload.weekLabel || state.weekLabel;
  state.dateText = payload.dateText || state.dateText;
  state.rows = Array.isArray(payload.rows) ? payload.rows.map(normalizeRow) : state.rows;
  state.coordMessage = payload.coordMessage || "";

  updateHeaderImage();
  hydrateUI();
}

async function apiGet(action, params = {}) {
  const cb = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const url = new URL(GAS_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("callback", cb);
  url.searchParams.set("ts", Date.now());
  Object.entries(params).forEach(([key, value]) => {
    if(value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  return await new Promise((resolve, reject) => {
    const script = document.createElement("script");

    function cleanup() {
      try { delete window[cb]; } catch (_) { window[cb] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cb] = (resp) => {
      cleanup();
      if (resp && resp.ok) return resolve(resp.payload || null);
      return reject(new Error((resp && resp.error) || "Erro no backend"));
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Falha ao carregar dados do backend."));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function loadCurrentTeacher(){
  const profile = await apiGet("getTeacher", { teacherId: getTeacherId() });
  applyTeacherProfile(profile);
  return profile;
}

async function loadCalendarEvents(){
  try{
    state.calendarEvents = await apiGet("listCalendar") || [];
    hydrateUI();
  }catch(err){
    state.calendarEvents = [];
    toast(err.message || "Erro ao carregar calendário.");
  }
}

function startCalendarAutoRefresh(){
  setInterval(loadCalendarEvents, 60000);
}

async function loadFromBackend(key) {
  if(!getTeacherId() || !state.className) return null;
  const payload = await apiGet("get", {
    key: key || makeKey(),
    teacherId: getTeacherId(),
  });
  applyLessonPayload(payload || null);
  return payload || null;
}


function saveToBackend(options = {}) {
  if(!getTeacherId() || !state.className){
    if(!options.silent) toast("Link do professor inválido.");
    return Promise.resolve();
  }

  const payload = {
    key: makeKey(),
    teacherId: getTeacherId(),
    payload: buildLessonPayload(),
  };

  // Cross-origin POST via hidden iframe avoids CORS, and avoids URL-length limits.
  try {
    const iframeName = "gas_save_iframe";
    let iframe = document.getElementById(iframeName);
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = iframeName;
      iframe.name = iframeName;
      iframe.style.display = "none";
      document.body.appendChild(iframe);
    }

    const form = document.createElement("form");
    form.style.display = "none";
    form.method = "POST";
    form.action = GAS_URL;
    form.target = iframeName;

    const inAction = document.createElement("input");
    inAction.type = "hidden";
    inAction.name = "action";
    inAction.value = "save";

    const inData = document.createElement("input");
    inData.type = "hidden";
    inData.name = "data";
    inData.value = JSON.stringify(payload || {});

    const inTs = document.createElement("input");
    inTs.type = "hidden";
    inTs.name = "ts";
    inTs.value = String(Date.now());

    form.appendChild(inAction);
    form.appendChild(inData);
    form.appendChild(inTs);

    document.body.appendChild(form);
    form.submit();

    setTimeout(() => {
      try { form.remove(); } catch (_) {}
    }, 0);

    if(!options.silent) toast("Salvo.");
  } catch (err) {
    console.warn("saveToBackend failed:", err);
    if(!options.silent) toast("Erro ao salvar.");
  }
}



/* =========================
   UI HYDRATE
========================= */
function hydrateUI(){
  const weekLabel = document.getElementById("weekLabel");
  const dateField = document.getElementById("dateField");
  const teacherName = document.getElementById("teacherName");
  const coordMessage = document.getElementById("coordMessage");
  const termLabel = document.getElementById("termLabel");

  if(termLabel) termLabel.textContent = "Mover planejamento";
  if(weekLabel) weekLabel.textContent = state.weekLabel;
  if(dateField) dateField.innerText = state.dateText;
  if(teacherName) teacherName.innerText = state.teacher;

  const classLabel = document.getElementById("classLabel");
  if(classLabel) classLabel.textContent = `Turma: ${state.className}`;

  if(coordMessage){
    if(!state.isViewMode) coordMessage.setAttribute("contenteditable","true");
    coordMessage.innerHTML = state.coordMessage || "";
  }

  renderRows();
}

async function setWeek(mondayDate){
  state.weekStart = mondayDate;

  const mon = new Date(mondayDate);
  const fri = new Date(mondayDate);
  fri.setDate(fri.getDate()+4);

  const label = `(${mon.getDate()} a ${fri.getDate()} de ${MONTHS_PT[mon.getMonth()]})`;
  state.weekLabel = label;
  state.dateText = `${mon.getDate()} a ${fri.getDate()} de ${MONTHS_PT[mon.getMonth()]}`;

  state.rows = buildInitialRows(state.weekStart);

  setQueryParams({
    term: state.term,
    week: toISODate(state.weekStart),
    class: state.className,
    teacherId: state.teacherId,
  });

  hydrateUI();
  await loadFromBackend();
}

/* =========================
   SHARE (WhatsApp)
========================= */
function initShare(){
  const shareBtn = document.getElementById("shareBtn");
  if(!shareBtn || state.isViewMode) return;

  shareBtn.addEventListener("click", async () => {

    // ✅ monta o link primeiro
    const base = window.location.origin + window.location.pathname
      .replace("index.html","")
      .replace(/\/$/,"/");

    const viewLink =
      `${base}view.html?week=${encodeURIComponent(toISODate(state.weekStart))}&class=${encodeURIComponent(state.className)}&teacherId=${encodeURIComponent(getTeacherId())}`;

    const msg = `Planejamento (somente leitura):\n${viewLink}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;

    // ✅ abre IMEDIATAMENTE (pra não ser bloqueado no mobile)
    const win = window.open("about:blank", "_blank");

    // ✅ salva depois (não impede abrir o WhatsApp)
    await saveToBackend();

    // ✅ agora direciona a aba pro WhatsApp
    if(win){
      win.location.href = waUrl;
    }else{
      // fallback: se o navegador bloquear a aba, tenta abrir direto
      window.location.href = waUrl;
    }
  });
}


/* =========================
   LOAD FROM QUERY
========================= */
function applyQueryState(){
  const q = getQueryParams();

  state.term = q.term || state.term || "1";
  state.className = q.class || state.className || "";
  if(q.teacherId || q.teacherEmail) {
    state.teacherId = q.teacherId || q.teacherEmail;
    state.teacherEmail = state.teacherId;
  }

  let w = q.week ? fromISODate(q.week) : defaultWeekIfNone();
  state.weekStart = mondayOf(w);

  const mon = new Date(state.weekStart);
  const fri = new Date(state.weekStart);
  fri.setDate(fri.getDate()+4);

  state.weekLabel = `(${mon.getDate()} a ${fri.getDate()} de ${MONTHS_PT[mon.getMonth()]})`;
  state.dateText = `${mon.getDate()} a ${fri.getDate()} de ${MONTHS_PT[mon.getMonth()]}`;

  state.rows = buildInitialRows(state.weekStart);

  setQueryParams({
    term: state.term,
    week: toISODate(state.weekStart),
    class: state.className,
    teacherId: state.teacherId,
  });
}

/* =========================
   TOAST
========================= */
function toast(text){
  const t = document.createElement("div");
  t.style.position = "fixed";
  t.style.left = "50%";
  t.style.bottom = "90px";
  t.style.transform = "translateX(-50%)";
  t.style.background = "#111";
  t.style.color = "#fff";
  t.style.padding = "10px 12px";
  t.style.borderRadius = "14px";
  t.style.fontWeight = "800";
  t.style.boxShadow = "0 10px 24px rgba(0,0,0,.25)";
  t.style.zIndex = "99999";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 1600);
}

/* =========================
   INIT
========================= */
async function init(){
  applyQueryState();
  initAuth();
  initToolbar();
  initToolbarAutoHide();

  await loadCalendarEvents();
  startCalendarAutoRefresh();

  if(getTeacherId()) {
    try{
      await loadCurrentTeacher();
    }catch(err){
      toast(err.message || "Erro ao carregar cadastro do professor.");
    }
  }else{
    toast("Abra pelo link enviado pela coordenação.");
  }

  hydrateUI();

  initWeekPicker();
  initTermPicker();
  initClassPicker(); 
  initShare();
  initWeekArrows(); //Chama a seta de calendario


  const saveBtn = document.getElementById("saveBtn");
  if(saveBtn && !state.isViewMode){
    saveBtn.addEventListener("click", saveToBackend);
  }

  await loadFromBackend();
}

init();
