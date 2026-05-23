const CONTROL_SPREADSHEET_ID = "1AnW4Hb4MFcN8k27ZXiB_9mzjzwHd_MdBPH8S-1VpASI";
const GOOGLE_CLIENT_ID = "433057640119-o2trlpqs7lac8kt2lbseitnm372em89b.apps.googleusercontent.com";
const ADMIN_EMAILS = ["normafederal@gmail.com"];

const TEACHERS_SHEET = "Teachers";
const LESSONS_SHEET = "Lessons";
const TEACHERS_HEADERS = ["email", "name", "classes", "spreadsheetId", "active", "createdAt", "isEnglishTeacher"];

function doGet(e) {
  const action = param(e, "action");
  const callback = param(e, "callback");

  try {
    const user = verifyUser_(param(e, "idToken"));
    let payload;

    if (action === "adminList") {
      requireAdmin_(user.email);
      payload = listTeachers_();
    } else if (action === "adminListLessons") {
      requireAdmin_(user.email);
      payload = listLessonsForTeacher_(param(e, "teacherEmail"));
    } else if (action === "get") {
      payload = getLesson_(user, param(e, "teacherEmail"), param(e, "key"));
    } else if (action === "me") {
      payload = getMe_(user, param(e, "teacherEmail"));
    } else {
      throw new Error("Ação desconhecida.");
    }

    return json_(callback, { ok: true, payload });
  } catch (err) {
    return json_(callback, { ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const action = param(e, "action");
    const data = JSON.parse(param(e, "data") || "{}");
    const user = verifyUser_(param(e, "idToken") || data.idToken);

    if (action === "save") {
      saveLesson_(user, data);
    } else if (action === "addTeacher") {
      requireAdmin_(user.email);
      addTeacher_(data);
    } else if (action === "updateTeacher") {
      requireAdmin_(user.email);
      updateTeacher_(data);
    } else {
      throw new Error("Ação desconhecida.");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message || String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function verifyUser_(idToken) {
  if (!idToken) throw new Error("Login do Google obrigatório.");

  const cache = CacheService.getScriptCache();
  const cacheKey = "token:" + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)
    .map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); })
    .join("");
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), {
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) throw new Error("Token do Google inválido.");

  const claims = JSON.parse(resp.getContentText());
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error("Token emitido para outro cliente.");
  if (claims.email_verified !== "true" && claims.email_verified !== true) throw new Error("Gmail não verificado.");

  const user = {
    email: String(claims.email || "").toLowerCase(),
    name: claims.name || "",
    picture: claims.picture || "",
    sub: claims.sub || "",
  };
  cache.put(cacheKey, JSON.stringify(user), 300);
  return user;
}

function getMe_(user, requestedEmail) {
  const teacherEmail = normalizeEmail_(requestedEmail || user.email);
  if (!canAccessTeacher_(user.email, teacherEmail)) throw new Error("Acesso negado.");
  const teacher = findTeacher_(teacherEmail);
  return {
    email: user.email,
    name: user.name,
    isAdmin: isAdmin_(user.email),
    teacher: teacher ? teacherToObject_(teacher) : null,
  };
}

function getLesson_(user, requestedEmail, key) {
  const teacherEmail = normalizeEmail_(requestedEmail || user.email);
  if (!canAccessTeacher_(user.email, teacherEmail)) throw new Error("Acesso negado.");
  if (!key) throw new Error("Chave do planejamento ausente.");

  const teacher = requireTeacher_(teacherEmail);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) return JSON.parse(rows[i][1] || "null");
  }
  return null;
}

function saveLesson_(user, data) {
  const teacherEmail = normalizeEmail_(data.teacherEmail || user.email);
  if (!canAccessTeacher_(user.email, teacherEmail)) throw new Error("Acesso negado.");
  if (!data.key) throw new Error("Chave do planejamento ausente.");

  const teacher = requireTeacher_(teacherEmail);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
  const rows = sheet.getDataRange().getValues();
  const json = JSON.stringify(data.payload || {});
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.key) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[json, now, user.email]]);
      return;
    }
  }
  sheet.appendRow([data.key, json, now, user.email]);
}

function addTeacher_(data) {
  const email = normalizeEmail_(data.email);
  if (!email) throw new Error("O Gmail do professor é obrigatório.");
  if (findTeacher_(email)) throw new Error("Professor já cadastrado.");

  const name = String(data.name || email).trim();
  const classes = String(data.classes || "").trim();
  const isEnglishTeacher = data.isEnglishTeacher === true || data.isEnglishTeacher === "true";
  const teacherSs = SpreadsheetApp.create("Planejamento - " + name);
  ensureSheet_(teacherSs, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);

  const sheet = teachersSheet_();
  sheet.appendRow([email, name, classes, teacherSs.getId(), true, new Date(), isEnglishTeacher]);
}

function updateTeacher_(data) {
  const email = normalizeEmail_(data.email);
  const sheet = teachersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizeEmail_(rows[i][0]) === email) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[
        String(data.name || rows[i][1]).trim(),
        String(data.classes || rows[i][2]).trim(),
        rows[i][3],
      ]]);
      sheet.getRange(i + 1, 5).setValue(data.active !== false);
      sheet.getRange(i + 1, 7).setValue(data.isEnglishTeacher === true || data.isEnglishTeacher === "true");
      return;
    }
  }
  throw new Error("Professor não encontrado.");
}

function listTeachers_() {
  return teachersSheet_().getDataRange().getValues().slice(1).map(teacherToObject_);
}

function listLessonsForTeacher_(teacherEmail) {
  const teacher = requireTeacher_(teacherEmail);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
  const rows = sheet.getDataRange().getValues();
  const lessons = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    let payload = null;
    try {
      payload = JSON.parse(rows[i][1] || "null");
    } catch (_) {
      payload = null;
    }
    lessons.push({
      key: rows[i][0],
      payload: payload,
      updatedAt: rows[i][2] || "",
      updatedBy: rows[i][3] || "",
    });
  }

  lessons.sort(function (a, b) {
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });

  return lessons;
}

function requireTeacher_(email) {
  const teacher = findTeacher_(email);
  if (!teacher || !teacher.active) throw new Error("Professor não cadastrado.");
  if (!teacher.spreadsheetId) throw new Error("Planilha do professor não encontrada.");
  return teacher;
}

function findTeacher_(email) {
  const rows = teachersSheet_().getDataRange().getValues();
  const normalized = normalizeEmail_(email);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeEmail_(rows[i][0]) === normalized) return teacherToObject_(rows[i]);
  }
  return null;
}

function teachersSheet_() {
  const ss = SpreadsheetApp.openById(CONTROL_SPREADSHEET_ID);
  return ensureSheet_(ss, TEACHERS_SHEET, TEACHERS_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach(function (header, index) {
      if (currentHeaders[index] !== header) {
        sheet.getRange(1, index + 1).setValue(header);
      }
    });
  }
  return sheet;
}

function canAccessTeacher_(actorEmail, teacherEmail) {
  return isAdmin_(actorEmail) || normalizeEmail_(actorEmail) === normalizeEmail_(teacherEmail);
}

function requireAdmin_(email) {
  if (!isAdmin_(email)) throw new Error("Acesso de coordenação obrigatório.");
}

function isAdmin_(email) {
  const normalized = normalizeEmail_(email);
  return ADMIN_EMAILS.map(normalizeEmail_).indexOf(normalized) !== -1;
}

function teacherToObject_(row) {
  return {
    email: normalizeEmail_(row[0]),
    name: row[1] || "",
    classes: row[2] || "",
    spreadsheetId: row[3] || "",
    active: row[4] === true || row[4] === "TRUE" || row[4] === "true",
    createdAt: row[5] || "",
    isEnglishTeacher: row[6] === true || row[6] === "TRUE" || row[6] === "true",
  };
}

function normalizeEmail_(email) {
  return String(email || "").trim().toLowerCase();
}

function param(e, key) {
  return e && e.parameter && e.parameter[key] ? e.parameter[key] : "";
}

function json_(callback, obj) {
  const body = callback
    ? callback + "(" + JSON.stringify(obj) + ");"
    : JSON.stringify(obj);
  return ContentService
    .createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
