const adminConfig = window.LESSON_PREP_CONFIG || {};
const adminGasUrl = new URLSearchParams(window.location.search).get("gas") || adminConfig.gasUrl || "";

const ADMIN_CLASSES = ["Infantil 5", "1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano"];
const MONTHS_PT_ADMIN = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];
const IMPORT_PROMPT = `Você vai ler o calendário escolar anexado e devolver SOMENTE JSON válido, sem markdown e sem explicações.

Formato obrigatório:
{
  "events": [
    {
      "date": "AAAA-MM-DD",
      "title": "Título curto que aparecerá no calendário",
      "html": "Descrição em HTML simples. Use apenas <b>, <i>, <u>, <br>, <ul>, <ol>, <li>.",
      "color": "#dff4df",
      "isObservation": false
    }
  ]
}

Regras:
- Use datas reais no formato ISO AAAA-MM-DD.
- Crie um item para cada feriado, recesso, programação especial, prova, conselho, reunião ou evento relevante.
- Use isObservation=false para itens fixos que o professor não pode alterar, como feriado, recesso e programação.
- Use isObservation=true para lembretes que o professor pode adaptar, como provas, avisos e observações pedagógicas.
- Escolha cores claras em hexadecimal: verde claro para recesso/feriado, azul claro para programação, amarelo claro para avaliação/prova, lilás claro para reunião/observação.
- Não invente datas ausentes. Se houver dúvida, não inclua o item.`;

const adminState = {
  selectedTeacher: null,
  teachers: [],
  editingTeacher: null,
  teacherRefreshTimer: null,
  calendarDate: new Date(),
  calendarEvents: [],
  modalDate: "",
  pendingTeacherId: "",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function splitClasses(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function adminToast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function apiGet(action, params = {}) {
  const cb = "admin_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const url = new URL(adminGasUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("callback", cb);
  url.searchParams.set("ts", Date.now());
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    window[cb] = (resp) => {
      delete window[cb];
      script.remove();
      resp && resp.ok ? resolve(resp.payload) : reject(new Error(resp?.error || "Erro no backend"));
    };
    script.onerror = () => {
      delete window[cb];
      script.remove();
      reject(new Error("Não foi possível acessar o backend."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function apiPost(action, data) {
  return new Promise((resolve) => {
    const iframeName = "admin_save_iframe";
    let iframe = document.getElementById(iframeName);
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = iframeName;
      iframe.name = iframeName;
      iframe.style.display = "none";
      document.body.appendChild(iframe);
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = adminGasUrl;
    form.target = iframeName;
    form.style.display = "none";

    [["action", action], ["data", JSON.stringify(data || {})]].forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
    setTimeout(() => {
      form.remove();
      resolve();
    }, 500);
  });
}

function buildTeacherLink(teacher) {
  const params = new URLSearchParams(window.location.search);
  const url = new URL("index.html", window.location.href);
  url.search = "";
  url.searchParams.set("teacherId", teacher.teacherId || teacher.email);
  if (params.get("gas")) url.searchParams.set("gas", params.get("gas"));
  return url.toString();
}

function newTeacherId() {
  const random = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
  return `prof-${random}`;
}

function renderClassChecks(selected = []) {
  const host = document.getElementById("teacherClassesInput");
  if (!host) return;
  const selectedSet = new Set(selected);
  host.innerHTML = "";
  ADMIN_CLASSES.forEach((className) => {
    const label = document.createElement("label");
    label.className = "class-check";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(className)}"><span>${escapeHtml(className)}</span>`;
    label.querySelector("input").checked = selectedSet.has(className);
    host.appendChild(label);
  });
}

function selectedClasses() {
  return Array.from(document.querySelectorAll("#teacherClassesInput input:checked")).map((input) => input.value);
}

function renderTeachers(teachers) {
  adminState.teachers = teachers || [];
  const list = document.getElementById("teachersList");
  if (!list) return;
  list.innerHTML = "";

  if (!teachers.length) {
    list.innerHTML = `<div class="empty-state">Nenhum professor carregado.</div>`;
    return;
  }

  teachers.forEach((teacher) => {
    const item = document.createElement("article");
    item.className = "teacher-card";
    if (adminState.selectedTeacher?.teacherId === teacher.teacherId) item.classList.add("selected");
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(teacher.name)}</strong>
        <span>${escapeHtml(teacher.classes || "Sem turmas")}</span>
      </div>
      <div>
        <span>${teacher.isEnglishTeacher ? "Inglês" : "Geral"}</span>
        <a href="${buildTeacherLink(teacher)}" target="_blank" rel="noreferrer">Link</a>
        <a href="https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit" target="_blank" rel="noreferrer">Planilha</a>
      </div>
    `;
    item.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      selectTeacher(teacher);
    });
    list.appendChild(item);
  });
}

function renderTeacherClasses(teacher) {
  const list = document.getElementById("lessonsList");
  if (!list) return;
  list.innerHTML = "";

  if (!teacher) {
    list.innerHTML = `<div class="empty-state">Selecione um professor para ver as turmas e copiar o link.</div>`;
    return;
  }

  const teacherLink = buildTeacherLink(teacher);
  const classes = splitClasses(teacher.classes);
  const linkCard = document.createElement("article");
  linkCard.className = "teacher-card";
  linkCard.innerHTML = `
    <div>
      <strong>Link único do professor</strong>
      <span>${escapeHtml(teacherLink)}</span>
    </div>
    <div>
      <button class="btn btn-ghost" type="button">Copiar</button>
    </div>
  `;
  linkCard.querySelector("button").addEventListener("click", () => copyText(teacherLink));
  list.appendChild(linkCard);

  classes.forEach((className) => {
    const url = new URL(teacherLink);
    url.searchParams.set("class", className);
    const item = document.createElement("article");
    item.className = "teacher-card";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(className)}</strong>
        <span>${escapeHtml(teacher.name)}</span>
      </div>
      <div>
        <a href="${url.toString()}" target="_blank" rel="noreferrer">Abrir</a>
      </div>
    `;
    list.appendChild(item);
  });
}

function setTeacherLinkBox(teacher) {
  const box = document.getElementById("teacherLinkBox");
  const input = document.getElementById("teacherLinkInput");
  const wa = document.getElementById("whatsTeacherLink");
  if (!box || !input || !wa) return;

  if (!teacher) {
    box.hidden = true;
    input.value = "";
    wa.href = "#";
    return;
  }

  const link = buildTeacherLink(teacher);
  input.value = link;
  wa.href = `https://wa.me/?text=${encodeURIComponent(`Seu link de planejamento:\n${link}`)}`;
  box.hidden = false;
}

function selectTeacher(teacher) {
  adminState.selectedTeacher = teacher;
  const title = document.getElementById("lessonsTitle");
  if (title) title.textContent = `Turmas - ${teacher.name}`;
  setTeacherFormMode(teacher);
  setTeacherLinkBox(teacher);
  renderTeachers(adminState.teachers);
  renderTeacherClasses(teacher);
}

async function loadTeachers() {
  try {
    const wasEditing = Boolean(adminState.editingTeacher);
    const teachers = await apiGet("adminList");
    renderTeachers(teachers || []);
    if (adminState.pendingTeacherId) {
      const created = (teachers || []).find((teacher) => teacher.teacherId === adminState.pendingTeacherId);
      if (created) {
        adminState.pendingTeacherId = "";
        selectTeacher(created);
        return;
      }
    }
    if (adminState.selectedTeacher) {
      const selected = (teachers || []).find((teacher) => teacher.teacherId === adminState.selectedTeacher.teacherId);
      adminState.selectedTeacher = selected || null;
      if (adminState.selectedTeacher) {
        if (!wasEditing) setTeacherFormMode(adminState.selectedTeacher);
        setTeacherLinkBox(adminState.selectedTeacher);
        renderTeacherClasses(adminState.selectedTeacher);
      } else {
        setTeacherFormMode(null);
        setTeacherLinkBox(null);
        renderTeacherClasses(null);
      }
    }
  } catch (err) {
    adminToast(err.message);
  }
}

function startTeacherAutoRefresh() {
  if (adminState.teacherRefreshTimer) clearInterval(adminState.teacherRefreshTimer);
  adminState.teacherRefreshTimer = setInterval(loadTeachers, 10000);
}

function setTeacherFormMode(teacher) {
  adminState.editingTeacher = teacher || null;
  document.getElementById("teacherFormTitle").textContent = teacher ? "Editar professor" : "Cadastrar professor";
  document.getElementById("saveTeacherBtn").textContent = teacher ? "Salvar alterações" : "Cadastrar professor";
  document.getElementById("cancelTeacherEdit").hidden = !teacher;
  document.getElementById("deleteTeacherBtn").hidden = !teacher;
  document.getElementById("teacherNameInput").value = teacher?.name || "";
  document.getElementById("teacherEnglishInput").checked = Boolean(teacher?.isEnglishTeacher);
  renderClassChecks(splitClasses(teacher?.classes || ""));
}

function readTeacherForm() {
  return {
    name: document.getElementById("teacherNameInput").value,
    classes: selectedClasses(),
    isEnglishTeacher: document.getElementById("teacherEnglishInput").checked,
  };
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => adminToast("Copiado."),
    () => {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
      adminToast("Copiado.");
    }
  );
}

function renderCalendar() {
  const host = document.getElementById("adminCalendar");
  const label = document.getElementById("calendarMonthLabel");
  if (!host || !label) return;

  const year = adminState.calendarDate.getFullYear();
  const month = adminState.calendarDate.getMonth();
  label.textContent = `${MONTHS_PT_ADMIN[month]} ${year}`;
  host.innerHTML = "";

  ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach((day) => {
    const head = document.createElement("div");
    head.className = "calendar-weekday";
    head.textContent = day;
    host.appendChild(head);
  });

  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = toISODate(date);
    const events = adminState.calendarEvents.filter((event) => event.date === iso);
    const cell = document.createElement("button");
    cell.className = "calendar-day";
    if (date.getMonth() !== month) cell.classList.add("muted");
    cell.type = "button";
    cell.innerHTML = `<strong>${date.getDate()}</strong><div class="calendar-event-list"></div>`;
    const list = cell.querySelector(".calendar-event-list");
    events.forEach((event) => {
      const chip = document.createElement("span");
      chip.className = "calendar-event-chip";
      chip.style.backgroundColor = event.color || "#dff4df";
      chip.innerHTML = `${escapeHtml(event.title)} <em data-del="${escapeHtml(event.eventId)}">del</em>`;
      list.appendChild(chip);
    });
    cell.addEventListener("click", (event) => {
      const del = event.target.closest("[data-del]");
      if (del) {
        event.stopPropagation();
        deleteCalendarEvent(del.dataset.del);
        return;
      }
      openCalendarModal(iso);
    });
    host.appendChild(cell);
  }
}

function renderImports() {
  const host = document.getElementById("importsList");
  if (!host) return;
  const grouped = new Map();
  adminState.calendarEvents.forEach((event) => {
    if (!event.importId) return;
    if (!grouped.has(event.importId)) grouped.set(event.importId, []);
    grouped.get(event.importId).push(event);
  });
  host.innerHTML = "";
  Array.from(grouped.entries()).forEach(([importId, events], index) => {
    const row = document.createElement("div");
    row.className = "import-row";
    row.innerHTML = `
      <span>Importação ${index + 1}</span>
      <strong>${events.length} itens</strong>
      <button class="btn btn-danger" type="button">Deletar</button>
    `;
    row.querySelector("button").addEventListener("click", () => deleteCalendarImport(importId));
    host.appendChild(row);
  });
}

async function loadCalendar() {
  try {
    adminState.calendarEvents = await apiGet("listCalendar") || [];
    renderCalendar();
    renderImports();
  } catch (err) {
    adminToast(err.message);
  }
}

function openCalendarModal(date) {
  adminState.modalDate = date;
  document.getElementById("calendarModalTitle").textContent = `Adicionar item em ${date}`;
  document.getElementById("eventTitleInput").value = "";
  document.getElementById("eventHtmlInput").innerHTML = "";
  document.getElementById("eventColorInput").value = "#dff4df";
  document.getElementById("eventObservationInput").checked = false;
  openModal("calendarEventModal");
  document.getElementById("eventTitleInput").focus();
}

async function saveCalendarEvent() {
  const title = document.getElementById("eventTitleInput").value.trim();
  const html = document.getElementById("eventHtmlInput").innerHTML.trim() || title;
  if (!title) {
    adminToast("Informe o título.");
    return;
  }
  await apiPost("addCalendarEvent", {
    date: adminState.modalDate,
    title,
    html,
    color: document.getElementById("eventColorInput").value,
    isObservation: document.getElementById("eventObservationInput").checked,
  });
  closeModal("calendarEventModal");
  setTimeout(loadCalendar, 700);
}

async function deleteCalendarEvent(eventId) {
  await apiPost("deleteCalendarEvent", { eventId });
  setTimeout(loadCalendar, 700);
}

async function deleteCalendarImport(importId) {
  const ok = window.confirm("Deletar todos os itens desta importação?");
  if (!ok) return;
  await apiPost("deleteCalendarImport", { importId });
  setTimeout(loadCalendar, 700);
}

async function importDates() {
  const text = document.getElementById("importText").value.trim();
  if (!text) {
    adminToast("Cole o JSON da importação.");
    return;
  }
  await apiPost("importCalendarEvents", { text });
  document.getElementById("importText").value = "";
  adminToast("Importação enviada.");
  setTimeout(loadCalendar, 900);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function initAdminToolbar() {
  document.querySelectorAll("[data-admin-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => document.execCommand(btn.dataset.adminCmd, false, null));
  });
}

function initAdmin() {
  renderClassChecks();
  loadTeachers();
  loadCalendar();
  startTeacherAutoRefresh();
  initAdminToolbar();

  document.getElementById("refreshTeachers")?.addEventListener("click", loadTeachers);
  document.getElementById("copyTeacherLink")?.addEventListener("click", () => {
    const value = document.getElementById("teacherLinkInput").value;
    if (value) copyText(value);
  });
  document.getElementById("cancelTeacherEdit")?.addEventListener("click", () => {
    adminState.selectedTeacher = null;
    setTeacherFormMode(null);
    setTeacherLinkBox(null);
    renderTeachers(adminState.teachers);
    renderTeacherClasses(null);
    const title = document.getElementById("lessonsTitle");
    if (title) title.textContent = "Turmas";
  });
  document.getElementById("deleteTeacherBtn")?.addEventListener("click", async () => {
    if (!adminState.editingTeacher) return;
    const teacher = adminState.editingTeacher;
    const ok = window.confirm(`Deletar ${teacher.name}?`);
    if (!ok) return;
    await apiPost("deleteTeacher", { teacherId: teacher.teacherId });
    adminState.selectedTeacher = null;
    setTeacherFormMode(null);
    setTeacherLinkBox(null);
    renderTeacherClasses(null);
    adminToast("Professor deletado.");
    setTimeout(loadTeachers, 800);
  });
  document.getElementById("teacherForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readTeacherForm();
    if (!payload.classes.length) {
      adminToast("Selecione ao menos uma turma.");
      return;
    }
    if (adminState.editingTeacher) {
      await apiPost("updateTeacher", {
        ...payload,
        originalTeacherId: adminState.editingTeacher.teacherId,
      });
      adminToast("Professor atualizado.");
    } else {
      const teacherId = newTeacherId();
      adminState.pendingTeacherId = teacherId;
      await apiPost("addTeacher", { ...payload, teacherId });
      adminToast("Professor cadastrado.");
    }
    event.currentTarget.reset();
    adminState.selectedTeacher = null;
    setTeacherFormMode(null);
    setTeacherLinkBox(null);
    renderTeacherClasses(null);
    setTimeout(loadTeachers, 900);
  });

  document.getElementById("prevCalendarMonth")?.addEventListener("click", () => {
    adminState.calendarDate.setMonth(adminState.calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById("nextCalendarMonth")?.addEventListener("click", () => {
    adminState.calendarDate.setMonth(adminState.calendarDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById("closeCalendarEventModal")?.addEventListener("click", () => closeModal("calendarEventModal"));
  document.getElementById("saveCalendarEvent")?.addEventListener("click", saveCalendarEvent);
  document.getElementById("copyImportPrompt")?.addEventListener("click", () => copyText(IMPORT_PROMPT));
  document.getElementById("importDates")?.addEventListener("click", importDates);
}

initAdmin();
