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
  generalColumnWidths: [22, 19.5, 24.5, 19.5, 14.5],
  coordMessage: "",
  isViewMode: document.body.classList.contains("view-mode"),
  idToken: sessionStorage.getItem("lessonPrepIdToken") || "",
  googleUser: null,
  authReady: false,
  // Guarda contra perda de planejamento: só é seguro gravar uma semana depois
  // de ter LIDO o que o servidor tem pra ela. `loadedKey` guarda a chave que
  // foi carregada com sucesso; enquanto ela não bater com makeKey(), nenhum
  // save sai daqui. Sem isso, uma falha de rede no load deixava a tela em
  // branco (buildInitialRows) e o primeiro blur gravava esse branco por cima
  // do planejamento real — foi o que apagou a semana de 14/09 da Raquel.
  loadedKey: null,
  loadFailed: false,
  // Retrato do que o servidor devolveu na ultima leitura bem-sucedida. Serve
  // pra saber se a tela ficou vazia em cima de uma semana que TEM conteudo.
  serverSnapshot: null,
  // Chave para a qual a professora ja confirmou "sim, quero apagar mesmo".
  allowBlankKey: null,
  blankGuardKey: null,
  saveStatus: "idle",
  saveDetail: "",
  savedAt: null,
};

const GENERAL_ROWS_PER_DAY = 6;
const GENERAL_COLUMNS = [
  { field: "unitDay", label: "Disciplina", min: 18 },
  { field: "conteudo", label: "Conteúdo", min: 14 },
  { field: "desenvolvimento", label: "Desenvolvimento da aula", min: 18 },
  { field: "materiais", label: "Materiais para a aula", min: 14 },
  { field: "tarefas", label: "Tarefas", min: 12 },
];

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

function applyTeacherModeClass(){
  document.body.classList.toggle("non-english", isGeneralTeacher());
  document.body.classList.toggle("english-teacher", state.teacherProfileLoaded && state.isEnglishTeacher);
}

function isGeneralTeacher(){
  return state.teacherProfileLoaded && !state.isEnglishTeacher;
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
  applyTeacherModeClass();

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
  state.rows = ensureRowsForCurrentMode(state.rows, state.weekStart);
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
function emptyLessonRow(weekStart, weekday, dayOffset, slot = 0){
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOffset);
  return {
    date: toISODate(d),
    weekday: weekday.label,
    dayNum: d.getDate(),
    slot,
    unitDay: "",
    conteudo: "",
    desenvolvimento: "",
    materiais: "",
    tarefas: "",
    localRecess: false,
    observations: {},
  };
}

function buildInitialRows(weekStart){
  const rows = [];
  WEEKDAYS.forEach((w, idx) => {
    const count = isGeneralTeacher() ? GENERAL_ROWS_PER_DAY : 1;
    for(let slot = 0; slot < count; slot += 1){
      rows.push(emptyLessonRow(weekStart, w, idx, slot));
    }
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
    tarefas: row.tarefas || "",
    localRecess: Boolean(row.localRecess),
    observations: row.observations && typeof row.observations === "object" ? row.observations : {},
  };
}

function lessonFields(){
  const fields = ["unitDay", "conteudo", "desenvolvimento", "materiais"];
  if(isGeneralTeacher()) fields.push("tarefas");
  return fields;
}

function ensureRowsForCurrentMode(rows, weekStart){
  const source = Array.isArray(rows) ? rows.map(normalizeRow) : [];
  if(isGeneralTeacher()) return ensureGeneralRows(source, weekStart);
  return ensureEnglishRows(source, weekStart);
}

function ensureEnglishRows(source, weekStart){
  return WEEKDAYS.map((weekday, dayOffset) => {
    const empty = emptyLessonRow(weekStart, weekday, dayOffset, 0);
    const found = source.find((row) => row.date === empty.date);
    return found ? { ...empty, ...normalizeRow(found), slot: 0 } : empty;
  });
}

function ensureGeneralRows(source, weekStart){
  const used = new Set();
  const rows = [];
  WEEKDAYS.forEach((weekday, dayOffset) => {
    const base = emptyLessonRow(weekStart, weekday, dayOffset, 0);
    const sameDate = source.filter((row) => row.date === base.date);
    for(let slot = 0; slot < GENERAL_ROWS_PER_DAY; slot += 1){
      const exactIndex = sameDate.findIndex((row, index) => !used.has(`${base.date}:${index}`) && Number(row.slot || 0) === slot);
      const fallbackIndex = sameDate.findIndex((row, index) => !used.has(`${base.date}:${index}`));
      const sourceIndex = exactIndex >= 0 ? exactIndex : fallbackIndex;
      const found = sourceIndex >= 0 ? sameDate[sourceIndex] : null;
      if(sourceIndex >= 0) used.add(`${base.date}:${sourceIndex}`);
      const empty = emptyLessonRow(weekStart, weekday, dayOffset, slot);
      rows.push(found ? { ...empty, ...normalizeRow(found), slot } : empty);
    }
  });
  return rows;
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
  const rowsToToggle = isGeneralTeacher() ? state.rows.filter((item) => item.date === row.date) : [row];
  const nextValue = !rowsToToggle.some((item) => item.localRecess);
  rowsToToggle.forEach((item, position) => {
    item.localRecess = nextValue;
    if(item.localRecess){
      lessonFields().forEach((field) => item[field] = "");
      if(position === 0) item.conteudo = "Recesso";
    }else if(item.conteudo === "Recesso"){
      item.conteudo = "";
    }
  });
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
  if(isGeneralTeacher()){
    renderGeneralRows();
    return;
  }
  renderEnglishTableShell();
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

function renderEnglishTableShell(){
  const sheetInner = document.querySelector(".sheet-inner");
  if(!sheetInner || sheetInner.dataset.mode === "english") return;
  sheetInner.dataset.mode = "english";
  sheetInner.innerHTML = `
    <table class="lp-table">
      <colgroup>
        <col class="col-unit">
        <col class="col-content">
        <col class="col-dev">
        <col class="col-mat">
      </colgroup>
      <thead>
        <tr>
          <th>Unidade, dia</th>
          <th>Conteúdo</th>
          <th>Desenvolvimento da aula</th>
          <th>Materiais para a aula</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  `;
}

function renderGeneralRows(){
  const sheetInner = document.querySelector(".sheet-inner");
  if(!sheetInner) return;
  sheetInner.dataset.mode = "general";
  sheetInner.innerHTML = "";

  const week = document.createElement("div");
  week.className = "general-week";
  week.style.setProperty("--general-cols", state.generalColumnWidths.map((width) => `${width}%`).join(" "));

  WEEKDAYS.forEach((weekday, dayOffset) => {
    const dayRows = state.rows.filter((row) => row.weekday === weekday.label);
    if(!dayRows.length) return;
    const block = document.createElement("section");
    block.className = "general-day-block";

    const marker = document.createElement("div");
    marker.className = "general-day-marker";
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "day-badge";
    badge.title = "Marcar/desmarcar recesso";
    if(!state.isViewMode) badge.addEventListener("click", () => toggleLocalRecess(state.rows.indexOf(dayRows[0])));

    const dayNum = document.createElement("div");
    dayNum.className = "dayNum";
    dayNum.textContent = dayRows[0].dayNum;

    const weekPill = document.createElement("div");
    weekPill.className = "weekPill";
    weekPill.textContent = weekday.label;

    badge.append(dayNum, weekPill);
    marker.appendChild(badge);
    block.appendChild(marker);

    const body = document.createElement("div");
    body.className = "general-day-rows";

    const header = document.createElement("div");
    header.className = "general-header";
    GENERAL_COLUMNS.forEach((column, index) => {
      const cell = document.createElement("div");
      cell.className = "general-th";
      cell.textContent = column.label;
      if(index < GENERAL_COLUMNS.length - 1 && !state.isViewMode){
        const handle = document.createElement("span");
        handle.className = "col-resizer";
        handle.dataset.index = index;
        handle.setAttribute("aria-hidden", "true");
        cell.appendChild(handle);
      }
      header.appendChild(cell);
    });
    body.appendChild(header);

    dayRows.slice(0, GENERAL_ROWS_PER_DAY).forEach((row) => {
      const idx = state.rows.indexOf(row);
      const fixedEvents = fixedEventsForDate(row.date);
      const observationEvents = observationEventsForDate(row.date);
      const rowFixed = isFixedRow(row);
      const line = document.createElement("div");
      line.className = "general-row";
      if(rowFixed) line.classList.add("row-recess");

      GENERAL_COLUMNS.forEach((column) => {
        const cell = document.createElement("div");
        cell.className = "general-td";
        cell.dataset.label = column.label;

        if(column.field === "conteudo" && row.slot === 0 && (fixedEvents.length || observationEvents.length)){
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
            const current = row.observations?.[event.eventId] || event.html || event.title || "";
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
          cell.appendChild(eventsBox);
        }

        const rich = document.createElement("div");
        rich.className = "rich";
        rich.dataset.field = column.field;
        rich.dataset.index = idx;
        rich.innerHTML = row[column.field] || "";
        if(!state.isViewMode && !rowFixed) rich.contentEditable = "true";
        cell.appendChild(rich);
        line.appendChild(cell);
      });
      body.appendChild(line);
    });
    block.appendChild(body);
    week.appendChild(block);
  });

  sheetInner.appendChild(week);
  initColumnResizers();
  hookEditListeners();
}

function initColumnResizers(){
  if(!isGeneralTeacher() || state.isViewMode) return;
  document.querySelectorAll(".col-resizer").forEach((handle) => {
    if(handle.dataset.resizeBound === "true") return;
    handle.dataset.resizeBound = "true";
    handle.addEventListener("pointerdown", (event) => {
      if(window.matchMedia("(max-width: 640px)").matches) return;
      event.preventDefault();
      const index = Number(handle.dataset.index);
      const week = handle.closest(".general-week");
      if(!week || !Number.isFinite(index)) return;

      const startX = event.clientX;
      const startWidths = [...state.generalColumnWidths];
      const totalWidth = week.getBoundingClientRect().width || 1;
      handle.setPointerCapture?.(event.pointerId);
      document.body.classList.add("is-resizing-columns");

      const onMove = (moveEvent) => {
        const delta = ((moveEvent.clientX - startX) / totalWidth) * 100;
        const next = [...startWidths];
        const left = Math.max(GENERAL_COLUMNS[index].min, startWidths[index] + delta);
        const appliedDelta = left - startWidths[index];
        const right = Math.max(GENERAL_COLUMNS[index + 1].min, startWidths[index + 1] - appliedDelta);
        const actualDelta = startWidths[index + 1] - right;
        next[index] = startWidths[index] + actualDelta;
        next[index + 1] = right;
        state.generalColumnWidths = next;
        week.style.setProperty("--general-cols", next.map((width) => `${width}%`).join(" "));
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("is-resizing-columns");
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  });
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
  await loadWeekIntoState();
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
  state.rows = Array.isArray(payload.rows) ? ensureRowsForCurrentMode(payload.rows, state.weekStart) : state.rows;
  state.coordMessage = payload.coordMessage || "";

  updateHeaderImage();
  applyTeacherModeClass();
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


// Wrapper obrigatório em volta do loadFromBackend. Toda troca de semana/turma
// e o init passam por aqui. Regra: só libera a gravação (state.loadedKey) se a
// leitura do servidor TERMINOU. Uma semana que ainda não existe devolve null e
// isso é sucesso — o que não pode é falha de rede virar "semana em branco
// salvável".
async function loadWeekIntoState(){
  const key = makeKey();
  state.loadedKey = null;
  state.loadFailed = false;
  renderLoadGuardBanner();

  if(!getTeacherId() || !state.className) return null;

  try {
    const payload = await loadFromBackend(key);
    state.loadedKey = key;
    return payload;
  } catch (err) {
    state.loadFailed = true;
    console.error("loadFromBackend falhou para", key, err);
    renderLoadGuardBanner();
    return null;
  } finally {
    renderLoadGuardBanner();
  }
}

/* =========================
   RASCUNHO LOCAL
   O que ela digita vai pro localStorage a cada pausa, antes e independente da
   rede. E o que sobra se o wifi cair, a aba fechar ou a luz acabar. So e
   apagado quando o SERVIDOR confirma a gravacao.
========================= */
let draftTimer = null;

function draftStorageKey(){
  return "lessonPrep:draft:" + getTeacherId() + ":" + makeKey();
}

function scheduleDraft(){
  if(draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { draftTimer = null; saveDraftLocally(); }, 400);
}

function saveDraftLocally(){
  // So guarda rascunho de semana que a gente sabe ter lido do servidor. Se a
  // leitura falhou, a tela e o template em branco - guardar isso criaria um
  // rascunho envenenado, que depois seria oferecido como "recuperar".
  if(state.loadedKey !== makeKey()) return;
  try{
    localStorage.setItem(draftStorageKey(), JSON.stringify({
      at: Date.now(),
      payload: buildLessonPayload(),
    }));
  }catch(_){ /* cota cheia / modo privado: segue sem rascunho */ }
}

function clearDraftLocally(){
  try{ localStorage.removeItem(draftStorageKey()); }catch(_){}
}

function readDraftLocally(){
  try{
    const bruto = localStorage.getItem(draftStorageKey());
    return bruto ? JSON.parse(bruto) : null;
  }catch(_){ return null; }
}

/* =========================
   INDICADOR DE GRAVACAO
   Antes a tela dizia "Salvo." assim que o formulario era enviado, sem esperar
   resposta nenhuma. Agora ela so diz "Salvo" quando o servidor confirmou, e
   diz em vermelho quando nao salvou.
========================= */
function setSaveStatus(status, detalhe){
  state.saveStatus = status;
  state.saveDetail = detalhe || "";
  if(status === "saved") state.savedAt = new Date();
  renderSaveStatus();
}

function renderSaveStatus(){
  if(state.isViewMode) return;
  const id = "saveStatusBox";
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = [
      "position:fixed","right:14px","bottom:14px","z-index:99997",
      "padding:10px 14px","border-radius:12px","font-weight:800",
      "max-width:min(420px,90vw)","box-shadow:0 8px 20px rgba(0,0,0,.2)",
      "font-size:14px","line-height:1.35"
    ].join(";");
    document.body.appendChild(el);
  }

  const dois = (n) => String(n).padStart(2, "0");
  const hora = state.savedAt ? dois(state.savedAt.getHours()) + ":" + dois(state.savedAt.getMinutes()) : "";
  const estilos = {
    idle:    ["#eef0f3", "#333", ""],
    saving:  ["#e7eefc", "#123", "Salvando\u2026"],
    saved:   ["#1d6f42", "#fff", "Salvo \u00e0s " + hora],
    blocked: ["#8a5a00", "#fff", "N\u00e3o gravei \u2014 confira o aviso no topo da tela"],
    error:   ["#b3261e", "#fff", "N\u00c3O SALVOU: " + state.saveDetail + ". O que voc\u00ea escreveu est\u00e1 guardado neste navegador \u2014 n\u00e3o feche a p\u00e1gina."],
  };
  const conf = estilos[state.saveStatus] || estilos.idle;
  if(!conf[2]){ el.remove(); return; }

  el.style.background = conf[0];
  el.style.color = conf[1];
  el.innerHTML = "";
  el.appendChild(document.createTextNode(conf[2]));

  if(state.saveStatus === "error"){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Tentar de novo";
    btn.style.cssText = "margin-left:10px;padding:6px 12px;border:0;border-radius:10px;font-weight:800;cursor:pointer";
    btn.addEventListener("click", () => { saveToBackend(); });
    el.appendChild(btn);
  }
}

/* =========================
   FAIXA: semana vazia sobre conteudo
========================= */
function renderBlankGuardBanner(){
  const id = "blankGuardBanner";
  let el = document.getElementById(id);
  if(!state.blankGuardKey){ if(el) el.remove(); return; }

  if(!el){
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:99998",
      "background:#8a5a00","color:#fff","padding:12px 16px",
      "font-weight:800","text-align:center","box-shadow:0 4px 14px rgba(0,0,0,.25)"
    ].join(";");
    document.body.appendChild(el);
  }
  el.innerHTML = "";

  const n = contarAulas(state.serverSnapshot);
  el.appendChild(document.createTextNode(
    "Esta semana tem " + n + (n === 1 ? " aula preenchida" : " aulas preenchidas") +
    " no servidor, e o que est\u00e1 na tela est\u00e1 vazio. N\u00c3O gravei. "
  ));

  const apagar = document.createElement("button");
  apagar.type = "button";
  apagar.textContent = "Sim, quero apagar";
  apagar.style.cssText = "margin:0 6px;padding:6px 12px;border:0;border-radius:10px;font-weight:800;cursor:pointer";
  apagar.addEventListener("click", () => {
    state.allowBlankKey = state.blankGuardKey;
    state.blankGuardKey = null;
    renderBlankGuardBanner();
    saveToBackend();
  });
  el.appendChild(apagar);

  const voltar = document.createElement("button");
  voltar.type = "button";
  voltar.textContent = "Recarregar do servidor";
  voltar.style.cssText = "margin:0 6px;padding:6px 12px;border:0;border-radius:10px;font-weight:800;cursor:pointer";
  voltar.addEventListener("click", () => {
    state.blankGuardKey = null;
    renderBlankGuardBanner();
    loadWeekIntoState();
  });
  el.appendChild(voltar);
}

/* =========================
   FAIXA: rascunho nao enviado
========================= */
function renderDraftBanner(rascunho){
  const id = "draftBanner";
  let el = document.getElementById(id);
  if(!rascunho){ if(el) el.remove(); return; }

  if(!el){
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:99996",
      "background:#123a6b","color:#fff","padding:12px 16px",
      "font-weight:800","text-align:center","box-shadow:0 4px 14px rgba(0,0,0,.25)"
    ].join(";");
    document.body.appendChild(el);
  }
  el.innerHTML = "";

  const dois = (n) => String(n).padStart(2, "0");
  const quando = new Date(rascunho.at);
  el.appendChild(document.createTextNode(
    "Encontrei altera\u00e7\u00f5es desta semana que n\u00e3o chegaram ao servidor (de " +
    dois(quando.getDate()) + "/" + dois(quando.getMonth() + 1) + " \u00e0s " +
    dois(quando.getHours()) + ":" + dois(quando.getMinutes()) + "). "
  ));

  const usar = document.createElement("button");
  usar.type = "button";
  usar.textContent = "Recuperar";
  usar.style.cssText = "margin:0 6px;padding:6px 12px;border:0;border-radius:10px;font-weight:800;cursor:pointer";
  usar.addEventListener("click", () => {
    applyLessonPayload(rascunho.payload);
    renderDraftBanner(null);
    saveToBackend();
  });
  el.appendChild(usar);

  const jogarFora = document.createElement("button");
  jogarFora.type = "button";
  jogarFora.textContent = "Descartar";
  jogarFora.style.cssText = "margin:0 6px;padding:6px 12px;border:0;border-radius:10px;font-weight:800;cursor:pointer";
  jogarFora.addEventListener("click", () => {
    clearDraftLocally();
    renderDraftBanner(null);
  });
  el.appendChild(jogarFora);
}

// Faixa fixa no topo avisando que a edição está travada. Sem isso a professora
// digitaria a semana inteira achando que está salvando.
function renderLoadGuardBanner(){
  const id = "loadGuardBanner";
  let el = document.getElementById(id);

  if(!state.loadFailed){
    if(el) el.remove();
    return;
  }
  if(!el){
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:99998",
      "background:#b3261e","color:#fff","padding:12px 16px",
      "font-weight:800","text-align:center","box-shadow:0 4px 14px rgba(0,0,0,.25)"
    ].join(";");
    document.body.appendChild(el);
  }
  el.innerHTML = "";

  const msg = document.createElement("span");
  msg.textContent = "Não consegui carregar esta semana do servidor. A gravação está travada para não apagar o seu planejamento. ";
  el.appendChild(msg);

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Tentar de novo";
  retry.style.cssText = "margin-left:8px;padding:6px 12px;border:0;border-radius:10px;font-weight:800;cursor:pointer";
  retry.addEventListener("click", () => { loadWeekIntoState(); });
  el.appendChild(retry);
}


async function saveToBackend(options = {}) {
  if(!getTeacherId() || !state.className){
    if(!options.silent) toast("Link do professor inválido.");
    return;
  }

  // NUNCA gravar uma semana que não foi lida do servidor: o que está na tela
  // nesse caso é o template em branco, não o planejamento da professora.
  if(state.loadedKey !== makeKey()){
    console.warn("saveToBackend bloqueado: semana não carregada do servidor.", makeKey());
    if(!options.silent) toast("Ainda não consegui carregar esta semana. Não vou salvar para não apagar o que já está lá.");
    return;
  }

  const key = makeKey();
  const corpo = buildLessonPayload();

  // Segunda guarda: a tela está vazia mas o servidor tem conteúdo. Em vez de
  // gravar (o acidente) ou recusar calado (o que atrapalha quem quer mesmo
  // limpar), pergunta.
  if(isBlankPayload(corpo) && !isBlankPayload(state.serverSnapshot) && state.allowBlankKey !== key){
    state.blankGuardKey = key;
    renderBlankGuardBanner();
    setSaveStatus("blocked");
    return;
  }

  saveDraftLocally();          // o rascunho vai pro disco ANTES de depender da rede
  setSaveStatus("saving");

  try {
    // POST urlencoded: é "simple request", não dispara preflight, e o Apps
    // Script preenche e.parameter normalmente. O importante é que agora dá pra
    // LER a resposta — antes isso ia num iframe cego e a tela dizia "Salvo."
    // sem o servidor ter respondido nada.
    const resposta = await fetch(GAS_URL, {
      method: "POST",
      body: new URLSearchParams({
        action: "save",
        data: JSON.stringify({ key: key, teacherId: getTeacherId(), payload: corpo }),
        ts: String(Date.now()),
      }),
    });
    if(!resposta.ok) throw new Error("o servidor respondeu HTTP " + resposta.status);

    let saida = null;
    try { saida = await resposta.json(); }
    catch(_) { throw new Error("resposta ilegível do servidor"); }

    if(!saida || saida.ok !== true) throw new Error((saida && saida.error) || "o servidor recusou a gravação");

    state.serverSnapshot = corpo;
    state.allowBlankKey = null;
    clearDraftLocally();
    setSaveStatus("saved");
  } catch (err) {
    // O rascunho local continua guardado de propósito — é o que ela digitou.
    console.error("saveToBackend falhou:", err);
    setSaveStatus("error", err && err.message ? err.message : String(err));
  }
}

// Espelho da checagem que existe no backend. "Vazio" olha só os campos de
// conteúdo: unitDay não conta, porque o template em branco já nasce com
// "BÍLINGUE" preenchido e passaria batido.
function isBlankPayload(corpo){
  const linhas = (corpo && corpo.rows) || [];
  const campos = [
    "conteudo","desenvolvimento","materiais","tarefas",
    "pppPresentation","pppPractice","pppProduction",
    "skillListening","skillWriting","skillReading","skillSpeaking"
  ];
  for(const linha of linhas){
    for(const campo of campos){
      if(semHtml(linha[campo]) !== "") return false;
    }
    const obs = linha.observations || {};
    for(const id in obs){ if(semHtml(obs[id]) !== "") return false; }
  }
  return semHtml(corpo && corpo.coordMessage) === "";
}

function semHtml(valor){
  return String(valor == null ? "" : valor)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contarAulas(corpo){
  const campos = ["conteudo","desenvolvimento","materiais","tarefas"];
  return ((corpo && corpo.rows) || [])
    .filter((linha) => campos.some((campo) => semHtml(linha[campo]) !== "")).length;
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
  await loadWeekIntoState();
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

  await loadWeekIntoState();
}

init();
