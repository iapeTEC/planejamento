// ============================================================================
// backend.gs — VERSÃO CORRIGIDA em 18/09/2026.
//
// Base: backend_live_2026-09-02.gs (o que estava rodando). Correções feitas
// depois do incidente em que a semana de 14/09 da professora Raquel foi
// apagada e substituída pelo template em branco:
//
//   1. LockService em saveLesson_  — duas gravações simultâneas liam a mesma
//      tabela e as duas caíam no appendRow, criando linhas duplicadas com a
//      mesma key (aconteceu com a Juliana em 2026-06-22_5_ano). Como a leitura
//      pegava a PRIMEIRA linha, o conteúdo real ficava invisível pra sempre.
//   2. getLesson_/saveLesson_ passam a usar a linha MAIS RECENTE quando há
//      chaves duplicadas, em vez da primeira — desenterra o que já foi perdido
//      desse jeito.
//   3. Histórico: antes de sobrescrever, a versão anterior vai pra aba
//      LessonsHistory. Recuperar deixa de depender do histórico do Sheets.
//   4. saveLesson_ recusa um payload 100% vazio por cima de um planejamento
//      que tem conteúdo. Rede de segurança — a trava de verdade está no
//      app.js, que não deixa gravar semana que não foi lida do servidor.
//   6. 22/09: parou de puxar a coluna `json` inteira a cada leitura/gravação
//      (era getDataRange().getValues() — megabytes por requisição), e passou a
//      arquivar no histórico só quando o conteúdo muda de verdade. O endpoint
//      é instável sob carga; isto reduz o peso de cada chamada.
//   5. gzip+base64 na célula (18/09, segunda rodada). Uma célula do Sheets
//      aceita 50.000 caracteres e a semana inteira cabe numa só; 19 das 125
//      semanas já passavam de 80% do teto e a maior estava em 99,3%. Comprimir
//      derruba a maior para 12,3%. Linhas antigas em JSON puro continuam
//      legíveis. Estourar o limite agora dá erro explícito, que o app mostra.
//
// COMO APLICAR: abrir o projeto no Apps Script, colar este conteúdo por cima
// do backend.gs e publicar uma NOVA versão da implantação (Implantar >
// Gerenciar implantações > editar > Versão: Nova versão). Sem republicar, a
// URL /exec continua servindo o código velho.
// ============================================================================

const CONTROL_SPREADSHEET_ID = "1AnW4Hb4MFcN8k27ZXiB_9mzjzwHd_MdBPH8S-1VpASI";
const GOOGLE_CLIENT_ID = "433057640119-o2trlpqs7lac8kt2lbseitnm372em89b.apps.googleusercontent.com";
const ADMIN_EMAILS = ["nayarapatricialima@gmail.com", "normafederal@gmail.com"];

const TEACHERS_SHEET = "Teachers";
const LESSONS_SHEET = "Lessons";
const LESSONS_HISTORY_SHEET = "LessonsHistory";
const GZIP_PREFIX = "gz:";
const CELL_LIMIT = 50000;
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
    let action = param(e, "action");
    let rawData = param(e, "data");

    // Se o proxy do Google Apps Script não preencheu e.parameter a partir do corpo,
    // extrai diretamente de e.postData.contents (suporta JSON ou urlencoded).
    if (e && e.postData && e.postData.contents) {
      const contents = e.postData.contents;
      if (contents.trim().startsWith("{") && contents.trim().endsWith("}")) {
        try {
          const bodyJson = JSON.parse(contents);
          if (!action && bodyJson.action) action = bodyJson.action;
          if (!rawData && bodyJson.data) {
            rawData = typeof bodyJson.data === "string" ? bodyJson.data : JSON.stringify(bodyJson.data);
          }
        } catch (_) {}
      } else {
        try {
          const parts = contents.split("&");
          for (let i = 0; i < parts.length; i++) {
            const pair = parts[i].split("=");
            if (pair.length >= 1) {
              const k = decodeURIComponent(pair[0].replace(/\+/g, " "));
              const v = decodeURIComponent((pair.slice(1).join("=") || "").replace(/\+/g, " "));
              if (!action && k === "action") action = v;
              if (!rawData && k === "data") rawData = v;
            }
          }
        } catch (_) {}
      }
    }

    const data = JSON.parse(rawData || "{}");

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

  const linha = findLessonRowIndex_(sheet, key);
  if (linha === -1) return null;
  return JSON.parse(decodeLessonJson_(sheet.getRange(linha, 2).getValue()) || "null");
}

// Uma celula do Google Sheets aceita no maximo 50.000 caracteres, e a semana
// inteira vai numa celula so. Em 03/09/2026, 19 das 125 semanas ja passavam de
// 80% desse teto e a maior estava em 99,3% - a cerca de 336 caracteres de a
// gravacao comecar a falhar. gzip+base64 reduz esse HTML de 3x a 12x nos dados
// reais: a maior celula cai de 49.664 para 6.136 caracteres (12,3% do limite),
// e o pior caso de compressao fica em 29,7%.
//
// Compatibilidade: linhas antigas, em JSON puro, continuam sendo lidas
// normalmente - e passam a ser gravadas comprimidas no proximo save.
function encodeLessonJson_(json) {
  const comprimido = Utilities.gzip(Utilities.newBlob(json, "application/json"));
  const texto = GZIP_PREFIX + Utilities.base64Encode(comprimido.getBytes());
  return texto.length < json.length ? texto : json;
}

function decodeLessonJson_(valor) {
  const texto = String(valor == null ? "" : valor);
  if (texto.indexOf(GZIP_PREFIX) !== 0) return texto;
  const bytes = Utilities.base64Decode(texto.substring(GZIP_PREFIX.length));
  return Utilities.ungzip(Utilities.newBlob(bytes, "application/x-gzip")).getDataAsString();
}

// Devolve o NUMERO DA LINHA na planilha (1-based), ou -1.
//
// Com chaves duplicadas na aba (ver item 1 do cabeçalho), a linha boa é a mais
// recente — não a primeira. Empate de data resolve pela última linha.
//
// Le so as colunas `key` e `updatedAt`. A versao anterior fazia
// getDataRange().getValues(), o que puxava junto a coluna `json` inteira — nas
// planilhas maiores sao megabytes transferidos a CADA leitura e a CADA
// gravacao, e a gravacao dispara em toda saida de campo. Isso pesava em cima de
// um endpoint que ja e instavel (ver item 3.1 do RELATORIO_PARA_ASTRA).
function findLessonRowIndex_(sheet, key) {
  const ultima = sheet.getLastRow();
  if (ultima < 2) return -1;

  const chaves = sheet.getRange(2, 1, ultima - 1, 1).getValues();
  const datas = sheet.getRange(2, 3, ultima - 1, 1).getValues();

  let melhor = -1;
  let melhorEm = null;

  for (let i = 0; i < chaves.length; i++) {
    if (chaves[i][0] !== key) continue;
    const at = datas[i][0] instanceof Date ? datas[i][0] : new Date(datas[i][0] || 0);
    const valida = at && !isNaN(at.getTime());
    if (melhor === -1 || !melhorEm || (valida && at.getTime() >= melhorEm.getTime())) {
      melhor = i + 2;   // +1 pelo cabeçalho, +1 porque a planilha é 1-based
      melhorEm = valida ? at : melhorEm;
    }
  }
  return melhor;
}

function saveLesson_(data) {
  const teacherId = normalizeId_(data.teacherId || data.teacherEmail);
  if (!teacherId) throw new Error("Link do professor inválido.");
  if (!data.key) throw new Error("Chave do planejamento ausente.");

  const teacher = requireTeacher_(teacherId);
  const payload = data.payload || {};
  const json = JSON.stringify(payload);
  const armazenado = encodeLessonJson_(json);

  // Estourar o limite da celula fazia o setValues falhar; com o save cego de
  // antes, a professora via "Salvo." mesmo assim. Agora a mensagem chega nela.
  if (armazenado.length > CELL_LIMIT) {
    throw new Error("Esta semana ficou grande demais para a planilha (" +
      armazenado.length + " de " + CELL_LIMIT + " caracteres). Avise a coordenacao.");
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error("Servidor ocupado. Tente salvar de novo.");

  try {
    const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
    const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
    const now = new Date();
    const linha = findLessonRowIndex_(sheet, data.key);

    if (linha === -1) {
      sheet.appendRow([data.key, armazenado, now, teacherId]);
      return;
    }

    // So esta linha e lida, em vez da coluna inteira.
    const anterior = String(sheet.getRange(linha, 2).getValue() || "");

    // Nada mudou: nao escreve, nao arquiva, nao gasta cota. O autosave dispara
    // em toda saida de campo, entao isto acontece muito.
    if (anterior === armazenado) return;

    if (isBlankLesson_(payload) && !isBlankLessonJson_(decodeLessonJson_(anterior))) {
      throw new Error("Gravação recusada: o conteúdo enviado está vazio e apagaria o planejamento salvo.");
    }

    // O historico guarda a celula exatamente como estava (comprimida ou nao),
    // pra nao gastar tempo de script re-codificando o que ja esta pronto.
    const meta = sheet.getRange(linha, 3, 1, 2).getValues()[0];
    archiveLesson_(ss, data.key, anterior, meta[0], meta[1]);
    sheet.getRange(linha, 2, 1, 3).setValues([[armazenado, now, teacherId]]);
  } finally {
    lock.releaseLock();
  }
}

// Uma semana é "vazia" quando nenhum campo de conteúdo tem texto de verdade.
// unitDay (a disciplina) de propósito NÃO conta: o template em branco que
// causou o acidente já vinha com "BÍLINGUE" preenchido em todos os dias.
function isBlankLesson_(payload) {
  const rows = (payload && payload.rows) || [];
  const fields = [
    "conteudo", "desenvolvimento", "materiais", "tarefas",
    "pppPresentation", "pppPractice", "pppProduction",
    "skillListening", "skillWriting", "skillReading", "skillSpeaking"
  ];

  for (let i = 0; i < rows.length; i++) {
    for (let f = 0; f < fields.length; f++) {
      if (stripHtml_(rows[i][fields[f]]) !== "") return false;
    }
    const obs = rows[i].observations || {};
    for (const id in obs) {
      if (stripHtml_(obs[id]) !== "") return false;
    }
  }
  return stripHtml_(payload && payload.coordMessage) === "";
}

function isBlankLessonJson_(json) {
  if (!json) return true;
  try {
    return isBlankLesson_(JSON.parse(json));
  } catch (err) {
    return false; // ilegível: trata como conteúdo, pra não deixar apagar
  }
}

function stripHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Guarda a versão anterior antes de sobrescrever.
function archiveLesson_(ss, key, previousJson, previousUpdatedAt, previousUpdatedBy) {
  if (!previousJson) return;
  const sheet = ensureSheet_(ss, LESSONS_HISTORY_SHEET, ["key", "json", "updatedAt", "updatedBy", "archivedAt"]);
  sheet.appendRow([key, previousJson, previousUpdatedAt || "", previousUpdatedBy || "", new Date()]);
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
    if (normalizeId_(rows[i][0]) === normalized || normalizeId_(rows[i][1]) === normalized) {
      return teacherToObject_(rows[i]);
    }
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