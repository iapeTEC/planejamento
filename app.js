/* =========================
   CONFIG
========================= */

// Tenho que lembrar de mudar, caso necessario.
// Cole aqui a URL do Web App do Google Apps Script (Deploy -> Web app)
const API_URL = "https://script.google.com/macros/s/AKfycbwCUPtllA8Ke-9joxJ7q7QeY0y-TBkbea33kbi2fIWjkltupp5msEUeX7sKlxzX-kqpMw/exec";
const PLATFORM_CONFIG = window.LESSON_PREP_CONFIG || {};

// A URL do Apps Script tambem pode vir por ?gas= ou por window.GAS_URL.
const _qs = new URLSearchParams(window.location.search);
const GAS_URL = _qs.get("gas") || window.GAS_URL || PLATFORM_CONFIG.gasUrl || API_URL;
const GOOGLE_CLIENT_ID = _qs.get("client_id") || PLATFORM_CONFIG.googleClientId || "";

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
  "1 Ano",
  "2 Ano",
  "3 Ano",
  "4 Ano",
  "5 Ano",
  "6 Ano",
];

/* =========================
   STATE
========================= */
const state = {
  term: "",
  className: "", // ✅ NOVO
  teacher: "",
  teacherEmail: "",
  allowedClasses: [],
  isEnglishTeacher: false,
  teacherProfileLoaded: false,
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
  return (state.teacherEmail || state.googleUser?.email || "").toLowerCase();
}

function splitClasses(value){
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAvailableClasses(){
  if(state.allowedClasses.length) return state.allowedClasses;
  if(GOOGLE_CLIENT_ID) return [];
  return DEFAULT_CLASSES;
}

function updateHeaderImage(){
  const img = document.getElementById("headerImage");
  if(!img) return;
  img.style.display = "";
  img.src = state.isEnglishTeacher ? "assets/header.png" : "assets/cabecalho.png";
}

function applyTeacherProfile(profile){
  if(!profile) throw new Error("Perfil do professor não carregado.");
  const teacher = profile.teacher || null;
  if(!teacher) throw new Error("Professor não cadastrado.");

  state.teacherEmail = teacher.email || state.teacherEmail;
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
    teacherEmail: state.teacherEmail,
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
    };
  });
  return rows;
}

function renderRows(){
  const rowsEl = document.getElementById("rows");
  if(!rowsEl) return;

  rowsEl.innerHTML = "";

  state.rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    // ✅ COL 1: Unit, Day
    const tdUnit = document.createElement("td");
    tdUnit.className = "td-unit";

    const badge = document.createElement("div");
    badge.className = "day-badge";
    badge.setAttribute("aria-hidden","true");

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
    if(!state.isViewMode) unitText.contentEditable = "true";

    tdUnit.appendChild(badge);
    tdUnit.appendChild(unitText);

    // ✅ COL 2
    const td2 = document.createElement("td");
    const conteudo = document.createElement("div");
    conteudo.className = "rich";
    conteudo.dataset.field = "conteudo";
    conteudo.dataset.index = idx;
    conteudo.innerHTML = r.conteudo || "";
    if(!state.isViewMode) conteudo.contentEditable = "true";
    td2.appendChild(conteudo);

    // ✅ COL 3
    const td3 = document.createElement("td");
    const des = document.createElement("div");
    des.className = "rich";
    des.dataset.field = "desenvolvimento";
    des.dataset.index = idx;
    des.innerHTML = r.desenvolvimento || "";
    if(!state.isViewMode) des.contentEditable = "true";
    td3.appendChild(des);

    // ✅ COL 4
    const td4 = document.createElement("td");
    const mat = document.createElement("div");
    mat.className = "rich";
    mat.dataset.field = "materiais";
    mat.dataset.index = idx;
    mat.innerHTML = r.materiais || "";
    if(!state.isViewMode) mat.contentEditable = "true";
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

  document.querySelectorAll(".rich[contenteditable='true']").forEach(el => {
    el.addEventListener("input", () => {
      const idx = Number(el.dataset.index);
      const field = el.dataset.field;
      if(Number.isFinite(idx) && field){
        state.rows[idx][field] = el.innerHTML;
      }
    });

    // ✅ mostra sempre no focus
    el.addEventListener("focus", () => showToolbar());
  });

  // COORD MESSAGE
  const coord = document.getElementById("coordMessage");
  if(coord && coord.getAttribute("contenteditable") === "true"){
    coord.addEventListener("focus", () => showToolbar());
    coord.addEventListener("input", () => {
      state.coordMessage = coord.innerHTML;
    });
  }

  // DATE FIELD
  const dateField = document.getElementById("dateField");
  if(dateField && dateField.getAttribute("contenteditable") === "true"){
    dateField.addEventListener("focus", () => showToolbar());
    dateField.addEventListener("input", () => {
      state.dateText = dateField.innerText.trim();
    });
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

  if(!GOOGLE_CLIENT_ID){
    authBar.innerHTML = `
      <div class="auth-status">
        <strong>Login do Google não configurado.</strong>
        <span>Configure googleClientId no platform-config.js para ativar o acesso privado.</span>
      </div>
    `;
    document.body.classList.remove("app-locked");
    state.authReady = true;
    return;
  }

  if(state.googleUser){
    const status = document.createElement("div");
    status.className = "auth-status";
    status.innerHTML = `<strong>${state.googleUser.name || state.googleUser.email}</strong><span>${state.googleUser.email}</span>`;

    const signOut = document.createElement("button");
    signOut.className = "btn btn-ghost";
    signOut.type = "button";
    signOut.textContent = "Sair";
    signOut.addEventListener("click", () => {
      sessionStorage.removeItem("lessonPrepIdToken");
      state.idToken = "";
      state.googleUser = null;
      state.authReady = false;
      document.body.classList.add("app-locked");
      renderAuthBar();
    });

    authBar.append(status, signOut);
    document.body.classList.remove("app-locked");
    state.authReady = true;
    return;
  }

  document.body.classList.add("app-locked");

  const status = document.createElement("div");
  status.className = "auth-status";
  status.innerHTML = `<strong>Entrar com Google</strong><span>Use o Gmail cadastrado para acessar seu planejamento.</span>`;

  const buttonHost = document.createElement("div");
  buttonHost.id = "googleSignInButton";
  authBar.append(status, buttonHost);

  if(!window.google?.accounts?.id) return;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async (response) => {
      try{
        state.idToken = response.credential;
        sessionStorage.setItem("lessonPrepIdToken", state.idToken);
        state.googleUser = decodeJwtPayload(state.idToken);
        if(!state.teacherEmail) state.teacherEmail = state.googleUser?.email || "";
        renderAuthBar();
        await loadCurrentTeacher();
        await loadFromBackend();
      }catch(err){
        toast(err.message || "Erro ao carregar cadastro do professor.");
      }
    },
  });
  google.accounts.id.renderButton(buttonHost, { theme: "outline", size: "large" });
}

function initAuth(){
  if(state.idToken){
    state.googleUser = decodeJwtPayload(state.idToken);
    if(!state.teacherEmail) state.teacherEmail = state.googleUser?.email || "";
  }

  if(!GOOGLE_CLIENT_ID){
    renderAuthBar();
    return;
  }

  const wait = setInterval(() => {
    if(window.google?.accounts?.id){
      clearInterval(wait);
      renderAuthBar();
    }
  }, 100);
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
    teacherEmail: state.teacherEmail,
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
  const termSelect = document.getElementById("termSelect");

  if(!termBtn || !termModal || !termSelect) return;
  if(state.isViewMode) return;

  termBtn.addEventListener("click", () => openModal("termModal"));
  document.getElementById("closeTermModal")?.addEventListener("click", () => closeModal("termModal"));

  document.getElementById("applyTerm")?.addEventListener("click", async () => {
    state.term = termSelect.value;
    document.getElementById("termLabel").textContent = `${state.term}º Bimestre - LIVRO/TURMA`;
    setQueryParams({ term: state.term, class: state.className, week: toISODate(state.weekStart) });
    await loadFromBackend();
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
  return `${state.term}_${toISODate(state.weekStart)}_${sanitizeKeyPart(state.className)}`;
}

function buildLessonPayload(){
  return {
    term: state.term,
    className: state.className,
    teacher: state.teacher,
    teacherEmail: getUserEmail(),
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
  state.teacherEmail = payload.teacherEmail || state.teacherEmail;
  state.weekLabel = payload.weekLabel || state.weekLabel;
  state.dateText = payload.dateText || state.dateText;
  state.rows = Array.isArray(payload.rows) ? payload.rows : state.rows;
  state.coordMessage = payload.coordMessage || "";

  updateHeaderImage();
  hydrateUI();
}

async function apiGet(action, params = {}) {
  if(GOOGLE_CLIENT_ID && !state.idToken) return null;

  const cb = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const url = new URL(GAS_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("idToken", state.idToken || "");
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
  const profile = await apiGet("me", { teacherEmail: state.teacherEmail || "" });
  applyTeacherProfile(profile);
  return profile;
}

async function loadFromBackend(key) {
  const payload = await apiGet("get", {
    key: key || makeKey(),
    teacherEmail: getUserEmail(),
  });
  applyLessonPayload(payload || null);
  return payload || null;
}


function saveToBackend() {
  if(GOOGLE_CLIENT_ID && !state.idToken){
    toast("Faça login com Google antes de salvar.");
    return Promise.resolve();
  }

  const payload = {
    key: makeKey(),
    teacherEmail: getUserEmail(),
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

    const inToken = document.createElement("input");
    inToken.type = "hidden";
    inToken.name = "idToken";
    inToken.value = state.idToken || "";

    const inData = document.createElement("input");
    inData.type = "hidden";
    inData.name = "data";
    inData.value = JSON.stringify(payload || {});

    const inTs = document.createElement("input");
    inTs.type = "hidden";
    inTs.name = "ts";
    inTs.value = String(Date.now());

    form.appendChild(inAction);
    form.appendChild(inToken);
    form.appendChild(inData);
    form.appendChild(inTs);

    document.body.appendChild(form);
    form.submit();

    setTimeout(() => {
      try { form.remove(); } catch (_) {}
    }, 0);

    toast("Salvo.");
  } catch (err) {
    console.warn("saveToBackend failed:", err);
    toast("Erro ao salvar.");
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

  if(termLabel) termLabel.textContent = `${state.term}º Bimestre - LIVRO/TURMA`;
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
    teacherEmail: state.teacherEmail,
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
      `${base}view.html?term=${encodeURIComponent(state.term)}&week=${encodeURIComponent(toISODate(state.weekStart))}&class=${encodeURIComponent(state.className)}&teacherEmail=${encodeURIComponent(getUserEmail())}`;

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
  if(q.teacherEmail) state.teacherEmail = q.teacherEmail;

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
    teacherEmail: state.teacherEmail,
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

  if(GOOGLE_CLIENT_ID && state.idToken) {
    try{
      await loadCurrentTeacher();
    }catch(err){
      toast(err.message || "Erro ao carregar cadastro do professor.");
    }
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

  if(!GOOGLE_CLIENT_ID || state.idToken) await loadFromBackend();
}

init();
