const CONTROL_SPREADSHEET_ID = "1AnW4Hb4MFcN8k27ZXiB_9mzjzwHd_MdBPH8S-1VpASI";
const GOOGLE_CLIENT_ID = "433057640119-o2trlpqs7lac8kt2lbseitnm372em89b.apps.googleusercontent.com";
const ADMIN_EMAILS = ["nayarapatricialima@gmail.com", "normafederal@gmail.com"];

const TEACHERS_SHEET = "Teachers";
const LESSONS_SHEET = "Lessons";
const CALENDAR_SHEET = "CalendarEvents";
const TEACHERS_HEADERS = ["teacherId", "name", "classes", "spreadsheetId", "active", "createdAt", "isEnglishTeacher"];
const CALENDAR_HEADERS = ["eventId", "date", "title", "html", "color", "isObservation", "importId", "createdAt"];

function doGet(e) {
  const action = param(e, "action");
  const callback = param(e, "callback");

  try {
    let payload;

    if (action === "adminList") {
      requireAdmin_(verifyUser_(param(e, "idToken")).email);
      payload = listTeachers_();
    } else if (action === "getTeacher") {
      payload = getTeacherProfile_(param(e, "teacherId") || param(e, "teacherEmail"));
    } else if (action === "get") {
      payload = getLesson_(param(e, "teacherId") || param(e, "teacherEmail"), param(e, "key"));
    } else if (action === "listCalendar") {
      payload = listCalendarEvents_();
    } else if (action === "me") {
      payload = getTeacherProfile_(param(e, "teacherId") || param(e, "teacherEmail"));
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

    if (action === "save") {
      saveLesson_(data);
    } else if (action === "addTeacher") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      addTeacher_(data);
    } else if (action === "updateTeacher") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      updateTeacher_(data);
    } else if (action === "deleteTeacher") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      deleteTeacher_(data);
    } else if (action === "addCalendarEvent") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      addCalendarEvent_(data);
    } else if (action === "deleteCalendarEvent") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      deleteCalendarEvent_(data);
    } else if (action === "importCalendarEvents") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      importCalendarEvents_(data);
    } else if (action === "deleteCalendarImport") {
      requireAdmin_(verifyUser_(param(e, "idToken") || data.idToken).email);
      deleteCalendarImport_(data);
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
    email: normalizeId_(claims.email),
    name: claims.name || "",
    picture: claims.picture || "",
    sub: claims.sub || "",
  };
  cache.put(cacheKey, JSON.stringify(user), 300);
  return user;
}

function requireAdmin_(email) {
  if (!isAdmin_(email)) throw new Error("Acesso de coordenação obrigatório.");
}

function isAdmin_(email) {
  const normalized = normalizeId_(email);
  return ADMIN_EMAILS.map(normalizeId_).indexOf(normalized) !== -1;
}

function getTeacherProfile_(teacherId) {
  const teacher = requireTeacher_(teacherId);
  return { teacher: teacher };
}

function getLesson_(teacherId, key) {
  if (!key) throw new Error("Chave do planejamento ausente.");

  const teacher = requireTeacher_(teacherId);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) return JSON.parse(rows[i][1] || "null");
  }
  return null;
}

function saveLesson_(data) {
  const teacherId = normalizeId_(data.teacherId || data.teacherEmail);
  if (!teacherId) throw new Error("Link do professor inválido.");
  if (!data.key) throw new Error("Chave do planejamento ausente.");

  const teacher = requireTeacher_(teacherId);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
  const rows = sheet.getDataRange().getValues();
  const json = JSON.stringify(data.payload || {});
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.key) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[json, now, teacherId]]);
      return;
    }
  }
  sheet.appendRow([data.key, json, now, teacherId]);
}

function addTeacher_(data) {
  const teacherId = normalizeId_(data.teacherId) || uniqueTeacherId_();
  if (findTeacher_(teacherId)) throw new Error("Link de professor já existe.");
  const name = String(data.name || "").trim();
  if (!name) throw new Error("O nome do professor é obrigatório.");

  const classes = normalizeClasses_(data.classes);
  if (!classes) throw new Error("Selecione ao menos uma turma.");

  const isEnglishTeacher = data.isEnglishTeacher === true || data.isEnglishTeacher === "true";
  const teacherSs = SpreadsheetApp.create("Planejamento - " + name);
  ensureSheet_(teacherSs, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);

  teachersSheet_().appendRow([teacherId, name, classes, teacherSs.getId(), true, new Date(), isEnglishTeacher]);
}

function updateTeacher_(data) {
  const originalId = normalizeId_(data.originalTeacherId || data.teacherId || data.email);
  if (!originalId) throw new Error("Professor não informado.");

  const name = String(data.name || "").trim();
  if (!name) throw new Error("O nome do professor é obrigatório.");

  const classes = normalizeClasses_(data.classes);
  if (!classes) throw new Error("Selecione ao menos uma turma.");

  const sheet = teachersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizeId_(rows[i][0]) === originalId) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[name, classes]]);
      sheet.getRange(i + 1, 5).setValue(data.active !== false);
      sheet.getRange(i + 1, 7).setValue(data.isEnglishTeacher === true || data.isEnglishTeacher === "true");
      return;
    }
  }
  throw new Error("Professor não encontrado.");
}

function deleteTeacher_(data) {
  const teacherId = normalizeId_(data.teacherId || data.email);
  if (!teacherId) throw new Error("Professor não informado.");

  const sheet = teachersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizeId_(rows[i][0]) === teacherId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
  throw new Error("Professor não encontrado.");
}

function addCalendarEvent_(data) {
  const event = normalizeCalendarEvent_(data, "");
  calendarSheet_().appendRow([
    event.eventId,
    event.date,
    event.title,
    event.html,
    event.color,
    event.isObservation,
    event.importId,
    new Date(),
  ]);
}

function deleteCalendarEvent_(data) {
  const eventId = String(data.eventId || "").trim();
  if (!eventId) throw new Error("Evento não informado.");

  const sheet = calendarSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === eventId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function importCalendarEvents_(data) {
  const events = parseImportPayload_(data.payload || data.text || "");
  if (!events.length) throw new Error("Nenhuma data válida encontrada.");

  const importId = Utilities.getUuid();
  const rows = events.map(function (item) {
    const event = normalizeCalendarEvent_(item, importId);
    return [
      event.eventId,
      event.date,
      event.title,
      event.html,
      event.color,
      event.isObservation,
      importId,
      new Date(),
    ];
  });

  calendarSheet_().getRange(calendarSheet_().getLastRow() + 1, 1, rows.length, CALENDAR_HEADERS.length).setValues(rows);
}

function deleteCalendarImport_(data) {
  const importId = String(data.importId || "").trim();
  if (!importId) throw new Error("Importação não informada.");

  const sheet = calendarSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][6]) === importId) sheet.deleteRow(i + 1);
  }
}

function listTeachers_() {
  return teachersSheet_().getDataRange().getValues().slice(1)
    .filter(function (row) { return row[0]; })
    .map(teacherToObject_);
}

function listCalendarEvents_() {
  return calendarSheet_().getDataRange().getValues().slice(1)
    .filter(function (row) { return row[0] && row[1]; })
    .map(calendarToObject_)
    .sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title));
    });
}

function requireTeacher_(teacherId) {
  const teacher = findTeacher_(teacherId);
  if (!teacher || !teacher.active) throw new Error("Professor não cadastrado.");
  if (!teacher.spreadsheetId) throw new Error("Planilha do professor não encontrada.");
  return teacher;
}

function findTeacher_(teacherId) {
  const rows = teachersSheet_().getDataRange().getValues();
  const normalized = normalizeId_(teacherId);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeId_(rows[i][0]) === normalized) return teacherToObject_(rows[i]);
  }
  return null;
}

function teachersSheet_() {
  const ss = SpreadsheetApp.openById(CONTROL_SPREADSHEET_ID);
  return ensureSheet_(ss, TEACHERS_SHEET, TEACHERS_HEADERS);
}

function calendarSheet_() {
  const ss = SpreadsheetApp.openById(CONTROL_SPREADSHEET_ID);
  return ensureSheet_(ss, CALENDAR_SHEET, CALENDAR_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach(function (header, index) {
      if (!currentHeaders[index]) {
        sheet.getRange(1, index + 1).setValue(header);
      }
    });
  }
  return sheet;
}

function teacherToObject_(row) {
  return {
    teacherId: normalizeId_(row[0]),
    email: normalizeId_(row[0]),
    name: row[1] || "",
    classes: row[2] || "",
    spreadsheetId: row[3] || "",
    active: isTruthy_(row[4]),
    createdAt: row[5] || "",
    isEnglishTeacher: isTruthy_(row[6]),
  };
}

function calendarToObject_(row) {
  return {
    eventId: String(row[0] || ""),
    date: formatDateValue_(row[1]),
    title: row[2] || "",
    html: row[3] || "",
    color: row[4] || "#dff4df",
    isObservation: isTruthy_(row[5]),
    importId: row[6] || "",
    createdAt: row[7] || "",
  };
}

function normalizeCalendarEvent_(data, importId) {
  const date = String(data.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data inválida: " + date);

  const title = String(data.title || "").trim();
  if (!title) throw new Error("Título obrigatório para " + date);

  return {
    eventId: String(data.eventId || Utilities.getUuid()),
    date: date,
    title: title,
    html: String(data.html || data.description || title).trim(),
    color: String(data.color || "#dff4df").trim(),
    isObservation: data.isObservation === true || data.isObservation === "true",
    importId: String(data.importId || importId || "").trim(),
  };
}

function parseImportPayload_(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error("Importação precisa estar em JSON válido.");
  }

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.events)) return parsed.events;
  throw new Error("JSON precisa ter um array ou o campo events.");
}

function uniqueTeacherId_() {
  let id;
  do {
    id = "prof-" + Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  } while (findTeacher_(id));
  return id;
}

function normalizeClasses_(classes) {
  if (Array.isArray(classes)) {
    return classes.map(String).map(function (item) { return item.trim(); }).filter(Boolean).join(", ");
  }
  return String(classes || "")
    .split(/[,;\n]+/)
    .map(function (item) { return item.trim(); })
    .filter(Boolean)
    .join(", ");
}

function isTruthy_(value) {
  return value === true || ["true", "sim", "yes", "1"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

function normalizeId_(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDateValue_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "").trim();
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