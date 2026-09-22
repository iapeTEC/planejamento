const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const storage = new Map();
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams,
    Date, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { location: { search: '', hash: '', href: 'https://example.org/index.html' } },
    document: { body: { classList: { contains: () => false } } },
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\ninit\(\);\s*$/, '\n');
  vm.runInContext(source, context);
  const offerDraft = context.offerDraftIfAny;
  vm.runInContext(`
    hydrateUI = renderLoadGuardBanner = renderBlankGuardBanner = renderDraftBanner =
      renderSaveStatus = offerDraftIfAny = toast = updateHeaderImage = applyTeacherModeClass = () => {};
    state.weekStart = new Date(2026, 8, 14);
    state.teacherId = 'prof-test'; state.className = 'Infantil 4';
    state.allowedClasses = ['Infantil 4'];
    state.rows = [{conteudo: 'original'}]; state.loadedKey = makeKey();
  `, context);
  return { context, storage, offerDraft, run: code => vm.runInContext(code, context) };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const success = () => ({ ok: true, json: async () => ({ok: true, payload: {revision: 'r2'}}) });

test('a resposta de outra semana nao substitui a semana atual', async () => {
  const h = harness(), first = deferred(), second = deferred();
  h.context.apiGet = (_action, params) => params.key.startsWith('2026-09-14') ? first.promise : second.promise;
  const oldLoad = h.run('loadWeekIntoState()');
  h.run('state.weekStart = new Date(2026, 8, 21)');
  const newLoad = h.run('loadWeekIntoState()');
  second.resolve({rows: [{date: '2026-09-21', conteudo: 'nova'}], lesson: {rows: [{date: '2026-09-21', conteudo: 'nova'}]}, revision: 'r1'});
  await newLoad;
  first.resolve({rows: [{date: '2026-09-14', conteudo: 'antiga'}], lesson: {rows: [{date: '2026-09-14', conteudo: 'antiga'}]}, revision: 'r0'});
  await oldLoad;
  assert.equal(h.run('state.rows[0].conteudo'), 'nova');
  assert.equal(h.run('state.loadedKey'), '2026-09-21_infantil_4');
});

test('confirmacao de save preserva edicao e rascunho feitos durante a rede', async () => {
  const h = harness(), pending = deferred();
  h.context.fetch = () => pending.promise;
  const saving = h.run('saveToBackend()');
  await tick();
  h.run('state.rows[0].conteudo = "edicao mais nova"; saveDraftLocally()');
  pending.resolve(success()); await saving;
  assert.equal(h.run('readDraftLocally().payload.rows[0].conteudo'), 'edicao mais nova');
  assert.equal(h.run('state.serverSnapshot.rows[0].conteudo'), 'original');
  assert.notEqual(h.run('state.saveStatus'), 'saved');
});

test('save antigo nao apaga rascunho nem altera status de outra semana', async () => {
  const h = harness(), pending = deferred();
  h.context.fetch = () => pending.promise;
  const saving = h.run('saveToBackend()'); await tick();
  h.run(`state.weekStart = new Date(2026, 8, 21); state.loadedKey = makeKey();
    state.rows = [{conteudo: 'outra semana'}]; saveDraftLocally(); state.saveStatus = 'idle';`);
  pending.resolve(success()); await saving;
  assert.equal(h.run('readDraftLocally().payload.rows[0].conteudo'), 'outra semana');
  assert.equal(h.run('state.saveStatus'), 'idle');
});

test('saves simultaneos sao serializados e preservam snapshots distintos', async () => {
  const h = harness(), pending = deferred(), calls = [];
  h.context.fetch = (_url, options) => { calls.push(JSON.parse(options.body.get('data')));
    return calls.length === 1 ? pending.promise : Promise.resolve(success()); };
  const first = h.run('saveToBackend()'); await tick();
  h.run('state.rows[0].conteudo = "segundo"');
  const second = h.run('saveToBackend()'); await tick();
  assert.equal(calls.length, 1);
  pending.resolve(success()); await Promise.all([first, second]);
  assert.equal(calls[0].payload.rows[0].conteudo, 'original');
  assert.equal(calls[1].payload.rows[0].conteudo, 'segundo');
  assert.equal(calls[1].baseRevision, 'r2');
});

test('modo leitura nunca envia gravacao', async () => {
  const h = harness(); let calls = 0;
  h.context.fetch = () => { calls++; return Promise.resolve(success()); };
  h.run('state.isViewMode = true'); await h.run('saveToBackend()');
  assert.equal(calls, 0);
});

test('erro de negocio nao dispara gravacoes repetidas', async () => {
  const h = harness(); let calls = 0;
  h.context.fetch = async () => { calls++; return {ok: true, json: async () => ({ok: false, error: 'Conflito', code: 'CONFLICT'})}; };
  h.run('esperar = async () => {}'); await h.run('saveToBackend()');
  assert.equal(calls, 1);
  assert.equal(h.run('state.saveStatus'), 'error');
});

test('payload lido nao pode mudar identidade da professora ou turma', () => {
  const h = harness();
  h.run('applyLessonPayload({teacherId: "outra", className: "2026-06-01_3_ano", rows: []})');
  assert.equal(h.run('state.teacherId'), 'prof-test');
  assert.equal(h.run('state.className'), 'Infantil 4');
});

test('save enfileirado nao usa revisao de uma leitura posterior', async () => {
  const h=harness(), pending=deferred(), calls=[];
  h.run(`lessonRevisions.set(lessonIdentity(getTeacherId(), makeKey()), 'r1')`);
  h.context.fetch=(_url, options)=>{
    calls.push(JSON.parse(options.body.get('data')));
    return calls.length===1?pending.promise:Promise.resolve(success());
  };
  const first=h.run('saveToBackend()'); await tick();
  h.run(`state.weekStart=new Date(2026,8,21); state.loadedKey=makeKey();
    lessonRevisions.set(lessonIdentity(getTeacherId(), makeKey()), 'r1'); state.rows[0].conteudo="enfileirado"`);
  const second=h.run('saveToBackend()');
  h.run(`lessonRevisions.set(lessonIdentity(getTeacherId(), makeKey()), 'outra-aba')`);
  pending.resolve(success());
  await first;
  await second;
  assert.equal(calls[1].baseRevision,'r1');
});

test('importacao sem identidade de semana e recusada', () => {
  // The file parser must reject missing identity, including a hand-edited export.
  const h=harness();
  return assert.rejects(h.run(`lerArquivoImportado({text: async () => JSON.stringify({app: 'planejamento-iape', payload:{rows:[]}})})`));
});

test('desfazer durante save enfileira a volta ao conteudo original', async () => {
  const h=harness(), pending=deferred(), calls=[];
  h.run('state.lastSavedSignature=JSON.stringify(buildLessonPayload()); state.rows[0].conteudo="novo"');
  h.context.fetch=(_url, options)=>{ calls.push(JSON.parse(options.body.get('data')));
    return calls.length===1?pending.promise:Promise.resolve(success()); };
  const first=h.run('saveToBackend()'); await tick();
  h.run('state.rows[0].conteudo="original"');
  const second=h.run('saveToBackend()');
  pending.resolve(success()); await Promise.all([first,second]);
  assert.equal(calls.length,2);
  assert.equal(calls[1].payload.rows[0].conteudo,'original');
  assert.equal(h.run('state.saveStatus'),'saved');
});

test('sair da semana sem editar preserva rascunho ainda nao recuperado', () => {
  const h=harness();
  h.run(`state.lastSavedSignature=JSON.stringify(buildLessonPayload());
    localStorage.setItem(draftStorageKey(),JSON.stringify({payload:{rows:[{conteudo:'rascunho antigo'}]}}));
    saveDraftLocally();`);
  assert.equal(h.run('readDraftLocally().payload.rows[0].conteudo'),'rascunho antigo');
});

test('rascunho com alteracao apenas no recado nao e descartado', () => {
  const h=harness();
  h.run(`state.serverSnapshot=JSON.parse(JSON.stringify(buildLessonPayload()));
    state.coordMessage='recado novo'; saveDraftLocally(); state.coordMessage='';`);
  h.offerDraft();
  assert.equal(h.run('readDraftLocally().payload.coordMessage'),'recado novo');
});

test('calendario nao inicia outra requisicao enquanto a anterior esta pendente', async () => {
  const h=harness(), pending=deferred(); let calls=0;
  h.context.apiGet=()=>{ calls++; return pending.promise; };
  const first=h.run('loadCalendarEvents()'), second=h.run('loadCalendarEvents()');
  pending.resolve([]); await Promise.all([first,second]);
  assert.equal(calls,1);
});
