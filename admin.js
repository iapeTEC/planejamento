const adminConfig = window.LESSON_PREP_CONFIG || {};
const adminGasUrl = new URLSearchParams(window.location.search).get("gas") || adminConfig.gasUrl || "";
const adminGoogleClientId = new URLSearchParams(window.location.search).get("client_id") || adminConfig.googleClientId || "";

const adminState = {
  idToken: sessionStorage.getItem("lessonPrepIdToken") || "",
  user: null,
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
    slot.textContent = "Set googleClientId in platform-config.js";
    return;
  }

  if (adminState.user) {
    const box = document.createElement("div");
    box.className = "signed-in-box";
    box.innerHTML = `<strong>${adminState.user.name || adminState.user.email}</strong><span>${adminState.user.email}</span>`;
    const out = document.createElement("button");
    out.className = "btn btn-ghost";
    out.type = "button";
    out.textContent = "Sign out";
    out.addEventListener("click", () => {
      sessionStorage.removeItem("lessonPrepIdToken");
      adminState.idToken = "";
      adminState.user = null;
      renderAdminAuth();
      renderTeachers([]);
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
      resp && resp.ok ? resolve(resp.payload) : reject(new Error(resp?.error || "Backend error"));
    };
    script.onerror = () => {
      delete window[cb];
      script.remove();
      reject(new Error("Could not reach backend."));
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
    list.innerHTML = `<div class="empty-state">No teachers loaded.</div>`;
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
        <span>${teacher.classes || "No classes"}</span>
        <a href="https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit" target="_blank" rel="noreferrer">Spreadsheet</a>
      </div>
    `;
    list.appendChild(item);
  });
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
  document.getElementById("teacherForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminState.idToken) {
      adminToast("Sign in first.");
      return;
    }
    await apiPost("addTeacher", {
      name: document.getElementById("teacherNameInput").value,
      email: document.getElementById("teacherEmailInput").value,
      classes: document.getElementById("teacherClassesInput").value,
    });
    event.currentTarget.reset();
    adminToast("Teacher added.");
    setTimeout(loadTeachers, 800);
  });
}

initAdmin();
