const adminConfig = window.LESSON_PREP_CONFIG || {};
const adminGasUrl = new URLSearchParams(window.location.search).get("gas") || adminConfig.gasUrl || "";
const adminGoogleClientId = new URLSearchParams(window.location.search).get("client_id") || adminConfig.googleClientId || "";

const adminState = {
  idToken: sessionStorage.getItem("lessonPrepIdToken") || "",
  user: null,
  selectedTeacher: null,
};

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
      renderAdminAuth();
      renderTeachers([]);
      renderLessons([]);
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
    item.innerHTML = `
      <div>
        <strong>${teacher.name || teacher.email}</strong>
        <span>${teacher.email}</span>
      </div>
      <div>
        <span>${teacher.classes || "Sem turmas"}</span>
        <span>${teacher.isEnglishTeacher ? "Inglês" : "Geral"}</span>
        <a href="https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit" target="_blank" rel="noreferrer">Planilha</a>
      </div>
    `;
    item.addEventListener("click", () => selectTeacher(teacher));
    list.appendChild(item);
  });
}

function renderLessons(lessons) {
  const list = document.getElementById("lessonsList");
  if (!list) return;
  list.innerHTML = "";

  if (!adminState.selectedTeacher) {
    list.innerHTML = `<div class="empty-state">Selecione um professor para ver os planejamentos.</div>`;
    return;
  }

  if (!lessons.length) {
    list.innerHTML = `<div class="empty-state">Nenhum planejamento lançado para este professor.</div>`;
    return;
  }

  lessons.forEach((lesson) => {
    const payload = lesson.payload || {};
    const term = payload.term || lesson.term || "";
    const week = payload.weekStart || lesson.weekStart || "";
    const className = payload.className || lesson.className || "";
    const title = `${term ? term + "º Bimestre" : "Planejamento"} - ${className || "Turma"}`;
    const editLink = `index.html?teacherEmail=${encodeURIComponent(adminState.selectedTeacher.email)}&term=${encodeURIComponent(term || "1")}&week=${encodeURIComponent(week)}&class=${encodeURIComponent(className)}`;
    const viewLink = `view.html?teacherEmail=${encodeURIComponent(adminState.selectedTeacher.email)}&term=${encodeURIComponent(term || "1")}&week=${encodeURIComponent(week)}&class=${encodeURIComponent(className)}`;

    const item = document.createElement("article");
    item.className = "teacher-card";
    item.innerHTML = `
      <div>
        <strong>${title}</strong>
        <span>${payload.weekLabel || week || "Semana não informada"}</span>
      </div>
      <div>
        <a href="${editLink}">Editar</a>
        <a href="${viewLink}">Visualizar</a>
      </div>
    `;
    list.appendChild(item);
  });
}

async function selectTeacher(teacher) {
  adminState.selectedTeacher = teacher;
  const title = document.getElementById("lessonsTitle");
  if (title) title.textContent = `Planejamentos - ${teacher.name || teacher.email}`;
  await loadLessons();
}

async function loadTeachers() {
  if (!adminState.idToken) return;
  try {
    const teachers = await apiGet("adminList");
    renderTeachers(teachers || []);
  } catch (err) {
    adminToast(err.message);
  }
}

async function loadLessons() {
  if (!adminState.idToken || !adminState.selectedTeacher) return;
  try {
    const lessons = await apiGet("adminListLessons", { teacherEmail: adminState.selectedTeacher.email });
    renderLessons(lessons || []);
  } catch (err) {
    adminToast(err.message);
  }
}

function initAdmin() {
  if (adminState.idToken) adminState.user = decodeJwtPayload(adminState.idToken);

  const wait = setInterval(() => {
    if (!adminGoogleClientId || window.google?.accounts?.id) {
      clearInterval(wait);
      renderAdminAuth();
      loadTeachers();
    }
  }, 100);

  document.getElementById("refreshTeachers")?.addEventListener("click", loadTeachers);
  document.getElementById("refreshLessons")?.addEventListener("click", loadLessons);
  document.getElementById("teacherForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminState.idToken) {
      adminToast("Entre com Google primeiro.");
      return;
    }
    await apiPost("addTeacher", {
      name: document.getElementById("teacherNameInput").value,
      email: document.getElementById("teacherEmailInput").value,
      classes: document.getElementById("teacherClassesInput").value,
      isEnglishTeacher: document.getElementById("teacherEnglishInput").checked,
    });
    event.currentTarget.reset();
    adminToast("Professor cadastrado.");
    setTimeout(loadTeachers, 800);
  });
}

initAdmin();
