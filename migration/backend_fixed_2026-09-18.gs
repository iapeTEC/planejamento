// ============================================================================
// backend.gs — VERSÃO CORRIGIDA em 18/09/2026.
// Revisao de 22/09: acesso autenticado, revisao otimista, auditoria e rotacao.
// Implantar junto do frontend correspondente; os links antigos sao substituidos.
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
const HISTORY_ACTIVE_LIMIT = 500;

function fail_(message, code) {
  const error = new Error(message);
  error.code = code || 'INVALID_REQUEST';
  throw error;
}

function loggedAction_(value) {
  const actions = ['health', 'getTeacher', 'get', 'getVersioned', 'listCalendar', 'me',
    'adminList', 'diagnostics', 'save', 'addTeacher', 'updateTeacher', 'deleteTeacher',
    'addCalendarEvent', 'deleteCalendarEvent', 'importCalendarEvents', 'deleteCalendarImport'];
  return actions.indexOf(value) === -1 ? 'unknown' : value;
}

function publicError_(error) {
  return {ok: false, code: error.code || 'SERVER_ERROR',
    error: error.code ? error.message : 'Falha interna no servidor. Tente novamente.'};
}

function ensureAccessSecret_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('LESSON_ACCESS_SECRET')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (!properties.getProperty('LESSON_ACCESS_SECRET')) {
      properties.setProperty('LESSON_ACCESS_SECRET', Utilities.getUuid() + Utilities.getUuid());
    }
  } finally { lock.releaseLock(); }
}

function teacherAccessToken_(teacherId, scope) {
  const secret = PropertiesService.getScriptProperties().getProperty('LESSON_ACCESS_SECRET');
  if (!secret) fail_('A coordenacao precisa emitir os novos links de acesso.', 'UNAUTHORIZED');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    normalizeId_(teacherId) + ':' + scope, secret)).replace(/=+$/, '');
}

function sameToken_(a, b) {
  a = String(a || ''); b = String(b || '');
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) difference |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return difference === 0;
}

function requireTeacherAccess_(teacherId, credentials, write) {
  credentials = credentials || {};
  if (credentials.idToken) {
    const user = verifyUser_(credentials.idToken);
    requireAdmin_(user.email);
    return 'admin:' + user.email;
  }
  const token = credentials.accessToken;
  if (!token) fail_('Abra o link de acesso enviado pela coordenacao.', 'UNAUTHORIZED');
  const edit = teacherAccessToken_(teacherId, 'edit');
  if (sameToken_(token, edit)) { requireTeacher_(teacherId); return 'teacher:' + normalizeId_(teacherId); }
  if (!write && sameToken_(token, teacherAccessToken_(teacherId, 'read'))) {
    requireTeacher_(teacherId); return 'reader:' + normalizeId_(teacherId);
  }
  fail_('Link de acesso invalido ou sem permissao.', 'UNAUTHORIZED');
}

function revision_(json) {
  if (!json) return 'absent';
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json)).replace(/=+$/, '');
}

function validateLesson_(teacher, key, payload) {
  const match = /^(\d{4}-\d{2}-\d{2})_([a-z0-9_]+)$/.exec(String(key || ''));
  if (!match) fail_('Chave do planejamento invalida.');
  const date = new Date(match[1] + 'T12:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] || date.getUTCDay() !== 1) {
    fail_('A semana precisa comecar em uma segunda-feira valida.');
  }
  const classes = String(teacher.classes || '').split(/[,;\n]+/).map(function (name) { return name.trim(); });
  const className = classes.find(function (name) {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') === match[2];
  });
  if (!className) fail_('Turma nao cadastrada para esta professora.');
  if (payload !== undefined) {
    if (!payload || payload.className !== className || payload.weekStart !== match[1] ||
        !Array.isArray(payload.rows) || payload.rows.some(function (row) { return !row || typeof row !== 'object' || Array.isArray(row); })) {
      fail_('O conteudo nao corresponde a turma e semana informadas.');
    }
    if (normalizeId_(payload.teacherId || payload.teacherEmail) !== teacher.teacherId) fail_('Professora do conteudo invalida.');
  }
}

function doGet(e) {
  const started = Date.now();
  const action = param(e, "action");
  const callback = param(e, "callback");

  try {
    let payload;
    const teacherId = param(e, 'teacherId') || param(e, 'teacherEmail');
    const credentials = {idToken: param(e, 'idToken'), accessToken: param(e, 'accessToken')};

    if (action === 'health') {
      payload = {version: '2026-09-22-secure', authenticationRequired: true};
    } else if (action === "adminList") {
      requireAdmin_(verifyUser_(param(e, "idToken")).email);
      ensureAccessSecret_();
      payload = listTeachers_().map(function (teacher) {
        delete teacher.spreadsheetId;
        teacher.accessToken = teacherAccessToken_(teacher.teacherId, 'edit');
        teacher.readToken = teacherAccessToken_(teacher.teacherId, 'read');
        return teacher;
      });
    } else if (action === "getTeacher") {
      requireTeacherAccess_(teacherId, credentials, false);
      payload = getTeacherProfile_(teacherId);
    } else if (action === 'getVersioned') {
      requireTeacherAccess_(teacherId, credentials, false);
      payload = getLessonVersioned_(teacherId, param(e, 'key'));
    } else if (action === "get") {
      requireTeacherAccess_(teacherId, credentials, false);
      payload = getLesson_(teacherId, param(e, 'key'));
    } else if (action === "listCalendar") {
      requireTeacherAccess_(teacherId, credentials, false);
      payload = listCalendarEvents_();
    } else if (action === "me") {
      requireTeacherAccess_(teacherId, credentials, false);
      payload = getTeacherProfile_(teacherId);
    } else if (action === 'diagnostics') {
      requireAdmin_(verifyUser_(credentials.idToken).email);
      payload = diagnoseTeacher_(teacherId);
    } else {
      fail_("Ação desconhecida.");
    }

    return json_(callback, { ok: true, payload });
  } catch (err) {
    console.error(JSON.stringify({action: loggedAction_(action), code: err.code || 'SERVER_ERROR'}));
    return json_(callback, publicError_(err));
  } finally {
    console.log(JSON.stringify({method: 'GET', action: loggedAction_(action), elapsedMs: Date.now() - started}));
  }
}

function doPost(e) {
  const started = Date.now();
  try {
    const action = param(e, "action");
    const data = JSON.parse(param(e, "data") || "{}");
    let payload = null;

    if (action === "save") {
      data.idToken = param(e, 'idToken') || data.idToken;
      payload = saveLesson_(data);
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
      fail_("Ação desconhecida.");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, payload: payload }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error(JSON.stringify({action: loggedAction_(param(e, 'action')), code: err.code || 'SERVER_ERROR'}));
    return ContentService
      .createTextOutput(JSON.stringify(publicError_(err)))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    console.log(JSON.stringify({method: 'POST', action: loggedAction_(param(e, 'action')), elapsedMs: Date.now() - started}));
  }
}

function verifyUser_(idToken) {
  if (!idToken) fail_("Login do Google obrigatório.", 'UNAUTHORIZED');

  const cache = CacheService.getScriptCache();
  const cacheKey = "token:" + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)
    .map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); })
    .join("");
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), {
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) fail_("Token do Google inválido.", 'UNAUTHORIZED');

  const claims = JSON.parse(resp.getContentText());
  if (claims.aud !== GOOGLE_CLIENT_ID) fail_("Token emitido para outro cliente.", 'UNAUTHORIZED');
  if (claims.email_verified !== "true" && claims.email_verified !== true) fail_("Gmail não verificado.", 'UNAUTHORIZED');
  const remainingSeconds = Math.floor(Number(claims.exp) - Date.now() / 1000);
  if (!isFinite(remainingSeconds) || remainingSeconds <= 0) fail_('Login expirado. Entre novamente.', 'UNAUTHORIZED');

  const user = {
    email: normalizeId_(claims.email),
    name: claims.name || "",
    picture: claims.picture || "",
    sub: claims.sub || "",
  };
  cache.put(cacheKey, JSON.stringify(user), Math.min(300, remainingSeconds));
  return user;
}

function requireAdmin_(email) {
  if (!isAdmin_(email)) fail_("Acesso de coordenação obrigatório.", 'UNAUTHORIZED');
}

function isAdmin_(email) {
  const normalized = normalizeId_(email);
  return ADMIN_EMAILS.map(normalizeId_).indexOf(normalized) !== -1;
}

function getTeacherProfile_(teacherId) {
  const teacher = requireTeacher_(teacherId);
  delete teacher.spreadsheetId;
  return { teacher: teacher, readToken: teacherAccessToken_(teacherId, 'read') };
}

function getLesson_(teacherId, key) {
  return getLessonVersioned_(teacherId, key).lesson;
}

function getLessonVersioned_(teacherId, key) {
  if (!key) fail_("Chave do planejamento ausente.");

  const teacher = requireTeacher_(teacherId);
  validateLesson_(teacher, key);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ss.getSheetByName(LESSONS_SHEET);
  if (!sheet) return {lesson: null, revision: 'absent'};

  const linha = findLessonRowIndex_(sheet, key);
  if (linha === -1) return {lesson: null, revision: 'absent'};
  const json = decodeLessonJson_(sheet.getRange(linha, 2).getValue());
  return {lesson: JSON.parse(json || 'null'), revision: revision_(json)};
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
  if (!teacherId) fail_("Link do professor inválido.");
  if (!data.key) fail_("Chave do planejamento ausente.");
  const actor = requireTeacherAccess_(teacherId, data, true);

  const teacher = requireTeacher_(teacherId);
  const payload = data.payload || {};
  validateLesson_(teacher, data.key, payload);
  if (typeof data.baseRevision !== 'string') fail_('Recarregue a semana antes de salvar.', 'CONFLICT');
  const json = JSON.stringify(payload);
  const armazenado = encodeLessonJson_(json);

  // Estourar o limite da celula fazia o setValues falhar; com o save cego de
  // antes, a professora via "Salvo." mesmo assim. Agora a mensagem chega nela.
  if (armazenado.length > CELL_LIMIT) {
    fail_("Esta semana ficou grande demais para a planilha (" +
      armazenado.length + " de " + CELL_LIMIT + " caracteres). Avise a coordenacao.");
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_("Servidor ocupado. Tente salvar de novo.", 'BUSY');

  try {
    const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
    const sheet = ensureSheet_(ss, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);
    const now = new Date();
    const linha = findLessonRowIndex_(sheet, data.key);
    const anterior = linha === -1 ? '' : String(sheet.getRange(linha, 2).getValue() || '');
    const previousJson = decodeLessonJson_(anterior);
    const nextRevision = revision_(json);
    if (previousJson === json) return {revision: nextRevision};
    if (revision_(previousJson) !== data.baseRevision) {
      fail_('Esta semana mudou em outra aba. Recarregue e confira seu rascunho antes de salvar.', 'CONFLICT');
    }

    if (linha === -1) {
      sheet.appendRow([data.key, armazenado, now, actor]);
      auditLesson_(ss, data.key, actor, data.baseRevision, nextRevision);
      SpreadsheetApp.flush();
      return {revision: nextRevision};
    }

    // So esta linha e lida, em vez da coluna inteira.

    // Nada mudou: nao escreve, nao arquiva, nao gasta cota. O autosave dispara
    // em toda saida de campo, entao isto acontece muito.

    if (data.allowBlank !== true && isBlankLesson_(payload) && !isBlankLessonJson_(previousJson)) {
      fail_("Gravação recusada: o conteúdo enviado está vazio e apagaria o planejamento salvo.");
    }

    // O historico guarda a celula exatamente como estava (comprimida ou nao),
    // pra nao gastar tempo de script re-codificando o que ja esta pronto.
    const meta = sheet.getRange(linha, 3, 1, 2).getValues()[0];
    archiveLesson_(ss, data.key, anterior, meta[0], meta[1]);
    sheet.getRange(linha, 2, 1, 3).setValues([[armazenado, now, actor]]);
    auditLesson_(ss, data.key, actor, data.baseRevision, nextRevision);
    SpreadsheetApp.flush();
    return {revision: nextRevision};
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
  const sheet = rotatingSheet_(ss, LESSONS_HISTORY_SHEET, ["key", "json", "updatedAt", "updatedBy", "archivedAt"]);
  sheet.appendRow([key, previousJson, previousUpdatedAt || "", previousUpdatedBy || "", new Date()]);
}

function rotatingSheet_(ss, name, headers) {
  let sheet = ensureSheet_(ss, name, headers);
  if (sheet.getLastRow() > HISTORY_ACTIVE_LIMIT) {
    sheet.setName(name + '_' + Date.now() + '_' + Utilities.getUuid().slice(0, 8));
    sheet = ensureSheet_(ss, name, headers);
  }
  return sheet;
}

function auditLesson_(ss, key, actor, previousRevision, nextRevision) {
  rotatingSheet_(ss, 'AuditLog', ['at', 'actor', 'action', 'key', 'previousRevision', 'revision'])
    .appendRow([new Date(), actor, 'save', key, previousRevision, nextRevision]);
  console.log(JSON.stringify({action: 'save', actor: actor, key: key, revision: nextRevision}));
}

function diagnoseTeacher_(teacherId) {
  const started = Date.now();
  const teacher = requireTeacher_(teacherId);
  const ss = SpreadsheetApp.openById(teacher.spreadsheetId);
  const sheet = ss.getSheetByName(LESSONS_SHEET);
  const counts = {};
  const invalidKeys = [];
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (row) {
      const key = String(row[0]); counts[key] = (counts[key] || 0) + 1;
      try { validateLesson_(teacher, key); } catch (_) { invalidKeys.push(key); }
    });
  }
  const history = ss.getSheetByName(LESSONS_HISTORY_SHEET);
  return {lessonRows: sheet ? sheet.getLastRow() - 1 : 0,
    activeHistoryRows: history ? history.getLastRow() - 1 : 0,
    duplicateKeys: Object.keys(counts).filter(function (key) { return counts[key] > 1; }),
    invalidKeys: invalidKeys, elapsedMs: Date.now() - started};
}

function addTeacher_(data) {
  const teacherId = normalizeId_(data.teacherId) || uniqueTeacherId_();
  if (findTeacher_(teacherId)) fail_("Link de professor já existe.");
  const name = String(data.name || "").trim();
  if (!name) fail_("O nome do professor é obrigatório.");

  const classes = normalizeClasses_(data.classes);
  if (!classes) fail_("Selecione ao menos uma turma.");

  const isEnglishTeacher = data.isEnglishTeacher === true || data.isEnglishTeacher === "true";
  const teacherSs = SpreadsheetApp.create("Planejamento - " + name);
  ensureSheet_(teacherSs, LESSONS_SHEET, ["key", "json", "updatedAt", "updatedBy"]);

  teachersSheet_().appendRow([teacherId, name, classes, teacherSs.getId(), true, new Date(), isEnglishTeacher]);
}

function updateTeacher_(data) {
  const originalId = normalizeId_(data.originalTeacherId || data.teacherId || data.email);
  if (!originalId) fail_("Professor não informado.");

  const name = String(data.name || "").trim();
  if (!name) fail_("O nome do professor é obrigatório.");

  const classes = normalizeClasses_(data.classes);
  if (!classes) fail_("Selecione ao menos uma turma.");

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
  fail_("Professor não encontrado.");
}

function deleteTeacher_(data) {
  const teacherId = normalizeId_(data.teacherId || data.email);
  if (!teacherId) fail_("Professor não informado.");

  const sheet = teachersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizeId_(rows[i][0]) === teacherId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
  fail_("Professor não encontrado.");
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
  if (!eventId) fail_("Evento não informado.");

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
  if (!events.length) fail_("Nenhuma data válida encontrada.");

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
  if (!importId) fail_("Importação não informada.");

  const sheet = calendarSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][6]) === importId) sheet.deleteRow(i + 1);
  }
}

function listTeachers_() {
  const sheet = teachersSheet_(false);
  return (sheet ? sheet.getDataRange().getValues().slice(1) : [])
    .filter(function (row) { return row[0]; })
    .map(teacherToObject_);
}

function listCalendarEvents_() {
  const sheet = calendarSheet_(false);
  return (sheet ? sheet.getDataRange().getValues().slice(1) : [])
    .filter(function (row) { return row[0] && row[1]; })
    .map(calendarToObject_)
    .sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title));
    });
}

function requireTeacher_(teacherId) {
  const teacher = findTeacher_(teacherId);
  if (!teacher || !teacher.active) fail_("Professor não cadastrado.");
  if (!teacher.spreadsheetId) fail_("Planilha do professor não encontrada.");
  return teacher;
}

function findTeacher_(teacherId) {
  const sheet = teachersSheet_(false);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const normalized = normalizeId_(teacherId);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeId_(rows[i][0]) === normalized) return teacherToObject_(rows[i]);
  }
  return null;
}

function teachersSheet_(create) {
  const ss = SpreadsheetApp.openById(CONTROL_SPREADSHEET_ID);
  if (create === false) return ss.getSheetByName(TEACHERS_SHEET);
  return ensureSheet_(ss, TEACHERS_SHEET, TEACHERS_HEADERS);
}

function calendarSheet_(create) {
  const ss = SpreadsheetApp.openById(CONTROL_SPREADSHEET_ID);
  if (create === false) return ss.getSheetByName(CALENDAR_SHEET);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_("Data inválida.");

  const title = String(data.title || "").trim();
  if (!title) fail_("Título obrigatório para " + date);

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
    fail_("Importação precisa estar em JSON válido.");
  }

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.events)) return parsed.events;
  fail_("JSON precisa ter um array ou o campo events.");
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
  if (callback && !/^[A-Za-z_$][\w$]*$/.test(callback)) {
    callback = '';
    obj = {ok: false, error: 'Callback invalido.', code: 'INVALID_REQUEST'};
  }
  const body = callback
    ? callback + "(" + JSON.stringify(obj) + ");"
    : JSON.stringify(obj);
  return ContentService
    .createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
