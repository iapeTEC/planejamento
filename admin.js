const adminConfig = window.LESSON_PREP_CONFIG || {};
const adminGasUrl = new URLSearchParams(window.location.search).get("gas") || adminConfig.gasUrl || "";
const adminGoogleClientId = new URLSearchParams(window.location.search).get("client_id") || adminConfig.googleClientId || "";

const adminState = {
  idToken: sessionStorage.getItem("lessonPrepIdToken") || "",
  user: null,
  selectedTeacher: null,
  teachers: [],
  editingTeacher: null,
  teacherRefreshTimer: null,
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch (_) {
    return null;
  }
}

function renderAdminAuth() {
  const slot = document.getElementById("adminAuth");
  if (!slot) return;
  slot.innerHTML = "";

  if (!adminGoogleClientId) {
    slot.textContent = "Configure googleClientId no platform-config.js";
    return;
  }

  if (adminState.user) {
    const box = document.createElement("div");
    box.className = "signed-in-box";
    box.innerHTML = `<strong>${adminState.user.name || adminState.user.email}</strong><span>${adminState.user.email}</span>`;
    const out = document.createElement("button");
    out.className = "btn btn-ghost";
    out.type = "button";
    out.textContent = "Sair";
    out.addEventListener("click", () => {
      sessionStorage.removeItem("lessonPrepIdToken");
      adminState.idToken = "";
      adminState.user = null;
      adminState.selectedTeacher = null;
      adminState.editingTeacher = null;
      if (adminState.teacherRefreshTimer) clearInterval(adminState.teacherRefreshTimer);
      adminState.teacherRefreshTimer = null;
      renderAdminAuth();
      renderTeachers([]);
      renderTeacherClasses(null);
      setTeacherFormMode(null);
    });
    slot.append(box, out);
    return;
  }

  const btn = document.createElement("div");
  btn.id = "adminGoogleButton";
  slot.appendChild(btn);
  google.accounts.id.initialize({
    client_id: adminGoogleClientId,
    callback: async (response) => {
      adminState.idToken = response.credential;
      sessionStorage.setItem("lessonPrepIdToken", adminState.idToken);
      adminState.user = decodeJwtPayload(adminState.idToken);
      renderAdminAuth();
      await loadTeachers();
    },
  });
  google.accounts.id.renderButton(btn, { theme: "outline", size: "large" });
}

function apiGet(action, params = {}) {
  const cb = "admin_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const url = new URL(adminGasUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("idToken", adminState.idToken);
  url.searchParams.set("callback", cb);
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

    [["action", action], ["idToken", adminState.idToken], ["data", JSON.stringify(data)]].forEach(([name, value]) => {
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
    if (adminState.selectedTeacher?.email === teacher.email) item.classList.add("selected");
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(teacher.name || teacher.email)}</strong>
        <span>${escapeHtml(teacher.email)}</span>
      </div>
      <div>
        <span>${escapeHtml(teacher.classes || "Sem turmas")}</span>
        <span>${teacher.isEnglishTeacher ? "Inglês" : "Geral"}</span>
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

function buildPlannerLink(teacher, className) {
  const params = new URLSearchParams(window.location.search);
  const url = new URL("index.html", window.location.href);
  url.search = "";
  url.searchParams.set("teacherEmail", teacher.email);
  url.searchParams.set("class", className);
  url.searchParams.set("term", "1");
  if (params.get("gas")) url.searchParams.set("gas", params.get("gas"));
  if (params.get("client_id")) url.searchParams.set("client_id", params.get("client_id"));
  return url.toString();
}

function renderTeacherClasses(teacher) {
  const list = document.getElementById("lessonsList");
  if (!list) return;
  list.innerHTML = "";

  if (!teacher) {
    list.innerHTML = `<div class="empty-state">Selecione um professor para ver as turmas.</div>`;
    return;
  }

  const classes = splitClasses(teacher.classes);
  if (!classes.length) {
    list.innerHTML = `<div class="empty-state">Nenhuma turma cadastrada para este professor.</div>`;
    return;
  }

  classes.forEach((className) => {
    const editLink = buildPlannerLink(teacher, className);
    const item = document.createElement("article");
    item.className = "teacher-card";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(className)}</strong>
        <span>${escapeHtml(teacher.name || teacher.email)}</span>
      </div>
      <div>
        <a href="${editLink}" target="_blank" rel="noreferrer">Abrir planejamento</a>
      </div>
    `;
    item.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      window.open(editLink, "_blank", "noopener");
    });
    list.appendChild(item);
  });
}

async function selectTeacher(teacher) {
  adminState.selectedTeacher = teacher;
  const title = document.getElementById("lessonsTitle");
  if (title) title.textContent = `Turmas - ${teacher.name || teacher.email}`;
  setTeacherFormMode(teacher);
  renderTeachers(adminState.teachers);
  renderTeacherClasses(teacher);
}

async function loadTeachers() {
  if (!adminState.idToken) return;
  try {
    const wasEditing = Boolean(adminState.editingTeacher);
    const teachers = await apiGet("adminList");
    renderTeachers(teachers || []);
    if (adminState.selectedTeacher) {
      const selected = (teachers || []).find((teacher) => teacher.email === adminState.selectedTeacher.email);
      adminState.selectedTeacher = selected || null;
      if (adminState.selectedTeacher) {
        if (!wasEditing) setTeacherFormMode(adminState.selectedTeacher);
        renderTeacherClasses(adminState.selectedTeacher);
      } else {
        setTeacherFormMode(null);
        renderTeacherClasses(null);
      }
    }
  } catch (err) {
    adminToast(err.message);
  }
}

function startTeacherAutoRefresh() {
  if (adminState.teacherRefreshTimer) clearInterval(adminState.teacherRefreshTimer);
  adminState.teacherRefreshTimer = setInterval(() => {
    if (adminState.idToken) loadTeachers();
  }, 10000);
}

function setTeacherFormMode(teacher) {
  adminState.editingTeacher = teacher || null;
  const form = document.getElementById("teacherForm");
  if (!form) return;

  document.getElementById("teacherFormTitle").textContent = teacher ? "Editar professor" : "Cadastrar professor";
  document.getElementById("saveTeacherBtn").textContent = teacher ? "Salvar alterações" : "Cadastrar professor";
  document.getElementById("cancelTeacherEdit").hidden = !teacher;
  document.getElementById("deleteTeacherBtn").hidden = !teacher;

  document.getElementById("teacherNameInput").value = teacher?.name || "";
  document.getElementById("teacherEmailInput").value = teacher?.email || "";
  document.getElementById("teacherClassesInput").value = teacher?.classes || "";
  document.getElementById("teacherEnglishInput").checked = Boolean(teacher?.isEnglishTeacher);
}

function readTeacherForm() {
  return {
    name: document.getElementById("teacherNameInput").value,
    email: document.getElementById("teacherEmailInput").value,
    classes: document.getElementById("teacherClassesInput").value,
    isEnglishTeacher: document.getElementById("teacherEnglishInput").checked,
  };
}

function initAdmin() {
  if (adminState.idToken) adminState.user = decodeJwtPayload(adminState.idToken);

  const wait = setInterval(() => {
    if (!adminGoogleClientId || window.google?.accounts?.id) {
      clearInterval(wait);
      renderAdminAuth();
      loadTeachers();
      startTeacherAutoRefresh();
    }
  }, 100);

  document.getElementById("refreshTeachers")?.addEventListener("click", loadTeachers);
  document.getElementById("cancelTeacherEdit")?.addEventListener("click", () => {
    adminState.selectedTeacher = null;
    setTeacherFormMode(null);
    renderTeachers(adminState.teachers);
    renderTeacherClasses(null);
    const title = document.getElementById("lessonsTitle");
    if (title) title.textContent = "Turmas";
  });
  document.getElementById("deleteTeacherBtn")?.addEventListener("click", async () => {
    if (!adminState.idToken || !adminState.editingTeacher) return;
    const teacher = adminState.editingTeacher;
    const ok = window.confirm(`Deletar ${teacher.name || teacher.email}?`);
    if (!ok) return;
    await apiPost("deleteTeacher", { email: teacher.email });
    adminState.selectedTeacher = null;
    setTeacherFormMode(null);
    renderTeacherClasses(null);
    adminToast("Professor deletado.");
    setTimeout(loadTeachers, 800);
  });
  document.getElementById("teacherForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminState.idToken) {
      adminToast("Entre com Google primeiro.");
      return;
    }
    const payload = readTeacherForm();
    if (adminState.editingTeacher) {
      await apiPost("updateTeacher", {
        ...payload,
        originalEmail: adminState.editingTeacher.email,
      });
      adminToast("Professor atualizado.");
    } else {
      await apiPost("addTeacher", payload);
      adminToast("Professor cadastrado.");
    }
    event.currentTarget.reset();
    adminState.selectedTeacher = null;
    setTeacherFormMode(null);
    renderTeacherClasses(null);
    setTimeout(loadTeachers, 800);
  });
}

initAdmin();
