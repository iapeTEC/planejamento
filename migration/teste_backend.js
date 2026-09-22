const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

class Sheet {
  constructor(rows = []) { this.rows = structuredClone(rows); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  appendRow(row) { this.rows.push([...row]); }
  setName(name) { this.name = name; return this; }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(row, col, count = 1, width = 1) {
    return {
      getValues: () => Array.from({length: count}, (_, r) => Array.from({length: width}, (_, c) => this.rows[row+r-1]?.[col+c-1] ?? '')),
      getValue: () => this.rows[row-1]?.[col-1] ?? '',
      setValues: values => values.forEach((cells, r) => cells.forEach((value, c) => {
        this.rows[row+r-1] ||= []; this.rows[row+r-1][col+c-1] = value;
      })),
      setValue: value => { this.rows[row-1] ||= []; this.rows[row-1][col-1] = value; },
    };
  }
}
function book(initial) {
  const sheets = Object.entries(initial).map(([name, rows]) => Object.assign(new Sheet(rows), {name}));
  return { sheets, getSheetByName: name => sheets.find(s => s.name === name) || null,
    insertSheet: name => { const s = Object.assign(new Sheet(), {name}); sheets.push(s); return s; } };
}
function harness() {
  const logs=[];
  const teacher = {teacherId:'prof-test', name:'Teste', classes:'Infantil 4', spreadsheetId:'private-sheet', active:true};
  const control = book({Teachers: [['teacherId','name','classes','spreadsheetId','active','createdAt','isEnglishTeacher'],
    ['prof-test','Teste','Infantil 4','private-sheet',true,'',false]], CalendarEvents:[['eventId','date']]});
  const lessons = book({Lessons:[['key','json','updatedAt','updatedBy']]});
  const props = new Map([['LESSON_ACCESS_SECRET', 'test-secret-not-for-production']]);
  const blob = value => ({getBytes: () => Buffer.isBuffer(value) ? value : Buffer.from(value), getDataAsString: () => Buffer.from(value).toString()});
  const context = vm.createContext({Date, console: {log(value){logs.push(value);}, error(value){logs.push(value);}, warn(){}},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props.get(k) || null, setProperty: (k,v) => props.set(k,v)})},
    CacheService: {getScriptCache: () => ({get:()=>null, put(){}, remove(){}})},
    LockService: {getScriptLock: () => ({tryLock:()=>true, releaseLock(){}, waitLock(){}})},
    SpreadsheetApp: {openById: id => id === teacher.spreadsheetId ? lessons : control, flush(){}},
    Utilities: {DigestAlgorithm:{SHA_256:'sha256'}, Charset:{UTF_8:'utf8'},
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()],
      computeHmacSha256Signature: (value,key) => [...crypto.createHmac('sha256',key).update(value).digest()],
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      base64Decode: text => Buffer.from(text,'base64'), getUuid: () => crypto.randomUUID(),
      newBlob: blob, gzip: b => blob(zlib.gzipSync(b.getBytes())), ungzip: b => blob(zlib.gunzipSync(b.getBytes())),
    },
    ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'}, createTextOutput: text => ({text,setMimeType(){return this;}})},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'backend_fixed_2026-09-18.gs'),'utf8'),context);
  return {context, lessons, control, props, logs, run: code => vm.runInContext(code,context),
    get: parameters => JSON.parse(context.doGet({parameter:parameters}).text),
    post: data => JSON.parse(context.doPost({parameter:{action:'save', data:JSON.stringify(data)}}).text),
  };
}
const lesson = content => ({teacherId:'prof-test', className:'Infantil 4', weekStart:'2026-09-14',
  rows:[{date:'2026-09-14',conteudo:content}], coordMessage:''});
const key = '2026-09-14_infantil_4';
function token(h, scope='edit') { return h.run(`teacherAccessToken_('prof-test', '${scope}')`); }
function seed(h, payload=lesson('original')) { h.lessons.getSheetByName('Lessons').appendRow([key,JSON.stringify(payload),'2026-09-22T12:00:00Z','prof-test']); }

test('leitura anonima nao expoe perfil, calendario ou planejamento', () => {
  const h=harness(); seed(h);
  for(const action of ['getTeacher','me','get','listCalendar']) assert.equal(h.get({action,teacherId:'prof-test',key}).ok,false,action);
});
test('save anonimo e recusado sem alterar a planilha', () => {
  const h=harness(); seed(h); const before=JSON.stringify(h.lessons.sheets);
  assert.equal(h.post({teacherId:'prof-test',key,payload:lesson('ataque')}).ok,false);
  assert.equal(JSON.stringify(h.lessons.sheets),before);
});
test('token autoriza somente sua professora e nao expoe spreadsheetId', () => {
  const h=harness(); const accessToken=token(h);
  const result=h.get({action:'getTeacher',teacherId:'prof-test',accessToken});
  assert.equal(result.ok,true); assert.equal(result.payload.teacher.spreadsheetId,undefined);
  assert.equal(h.get({action:'getTeacher',teacherId:'outra',accessToken}).ok,false);
});
test('token de leitura consegue ler mas nao gravar', () => {
  const h=harness(); seed(h); const accessToken=token(h,'read');
  assert.equal(h.get({action:'get',teacherId:'prof-test',key,accessToken}).ok,true);
  assert.equal(h.post({teacherId:'prof-test',key,accessToken,payload:lesson('ataque'),baseRevision:'absent'}).ok,false);
});
test('conflito de revisao preserva semana e historico', () => {
  const h=harness(); seed(h); const before=JSON.stringify(h.lessons.sheets);
  const result=h.post({teacherId:'prof-test',key,accessToken:token(h),payload:lesson('atrasado'),baseRevision:'absent'});
  assert.equal(result.ok,false); assert.equal(result.code,'CONFLICT');
  assert.equal(JSON.stringify(h.lessons.sheets),before);
});
test('save confirmado pode ser repetido sem duplicar historico ou auditoria', () => {
  const h=harness(); seed(h); const accessToken=token(h);
  const before=h.get({action:'getVersioned',teacherId:'prof-test',key,accessToken}).payload;
  const data={teacherId:'prof-test',key,accessToken,payload:lesson('novo'),baseRevision:before.revision};
  const first=h.post(data), second=h.post(data);
  assert.equal(first.ok,true); assert.equal(second.ok,true);
  assert.equal(second.payload.revision,first.payload.revision);
  assert.equal(h.lessons.getSheetByName('LessonsHistory').getLastRow(),2);
  assert.equal(h.lessons.getSheetByName('AuditLog').getLastRow(),2);
});
test('chaves invalidas, data impossivel, outra turma e rows invalidas nao gravam', () => {
  const h=harness(), accessToken=token(h);
  for(const [badKey,payload] of [
    ['2026-09-14_2026-06-01_3_ano',lesson('a')],
    ['2026-02-30_infantil_4',{...lesson('a'),weekStart:'2026-02-30'}],
    ['2026-09-14_3_ano',{...lesson('a'),className:'3º Ano'}],
    [key,{...lesson('a'),rows:[null]}],
  ]) assert.equal(h.post({teacherId:'prof-test',key:badKey,accessToken,payload,baseRevision:'absent'}).ok,false);
  assert.equal(h.lessons.getSheetByName('Lessons').getLastRow(),1);
});
test('limpeza explicita exige revisao correta e arquiva o original', () => {
  const h=harness(); seed(h); const accessToken=token(h);
  const revision=h.get({action:'getVersioned',teacherId:'prof-test',key,accessToken}).payload.revision;
  const data={teacherId:'prof-test',key,accessToken,payload:lesson(''),baseRevision:revision};
  assert.equal(h.post(data).ok,false);
  assert.equal(h.post({...data,allowBlank:true}).ok,true);
  assert.equal(h.lessons.getSheetByName('LessonsHistory').getLastRow(),2);
});
test('JSON antigo identico nao cria historico so por causa da compressao', () => {
  const h=harness(); seed(h,lesson('a'.repeat(1000))); const accessToken=token(h);
  const revision=h.get({action:'getVersioned',teacherId:'prof-test',key,accessToken}).payload.revision;
  assert.equal(h.post({teacherId:'prof-test',key,accessToken,payload:lesson('a'.repeat(1000)),baseRevision:revision}).ok,true);
  assert.equal(h.lessons.getSheetByName('LessonsHistory'),null);
});
test('rotacao preserva todas as versoes e limita aba ativa', () => {
  const h=harness();
  const history=h.lessons.insertSheet('LessonsHistory');
  history.appendRow(['key','json','updatedAt','updatedBy','archivedAt']);
  for(let i=0;i<500;i++) history.appendRow([key,'versao-'+i,'','','']);
  h.context.testBook=h.lessons;
  h.run(`archiveLesson_(testBook, '${key}', 'nova', '', '')`);
  assert.equal(h.lessons.getSheetByName('LessonsHistory').getLastRow(),2);
  assert.equal(h.lessons.sheets.filter(s=>s.name.startsWith('LessonsHistory')).reduce((n,s)=>n+s.getLastRow()-1,0),501);
});
test('callback JSONP malicioso nunca e executavel', () => {
  const h=harness();
  const response=h.context.doGet({parameter:{action:'get',callback:'alert(1)//'}}).text;
  assert.doesNotThrow(()=>JSON.parse(response));
});

test('falha Google nao expoe token na resposta nem nos logs', () => {
  const h=harness();
  h.context.UrlFetchApp={fetch(){throw new Error('https://oauth2.googleapis.com/tokeninfo?id_token=PRIVATE_TOKEN');}};
  const result=h.get({action:'adminList',idToken:'PRIVATE_TOKEN'});
  assert.equal(result.ok,false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
  assert.ok(!h.logs.join('').includes('PRIVATE_TOKEN'));
});

test('leitura nao cria abas de cadastro ou planejamento ausentes', () => {
  const h=harness(); h.control.sheets.splice(0,1);
  const count=h.control.sheets.length;
  h.get({action:'getTeacher',teacherId:'prof-test',accessToken:token(h)});
  assert.equal(h.control.sheets.length,count);
});

test('token Google expirado e rejeitado mesmo com email de admin', () => {
  const h=harness();
  h.context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({
    aud:h.run('GOOGLE_CLIENT_ID'),email:'normafederal@gmail.com',email_verified:true,exp:1,
  })})};
  assert.equal(h.get({action:'adminList',idToken:'expired'}).ok,false);
});

test('JSON invalido nao e incluido em logs ou resposta', () => {
  const h=harness();
  const result=h.context.doPost({parameter:{action:'save',data:'PRIVATE_TOKEN'}}).text;
  assert.ok(!result.includes('PRIVATE_TOKEN'));
  assert.ok(!h.logs.join('').includes('PRIVATE_TOKEN'));
});
