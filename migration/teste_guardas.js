// Testa as guardas que impedem um planejamento de ser apagado, e a compressao
// que tira as celulas de perto do limite de 50.000 caracteres do Sheets.
//
//   node migration/teste_guardas.js
//
// Roda as funcoes de verdade, extraidas do app.js, contra os dados reais do
// snapshot de 03/09 (que vive no repo privado planejamento-migration-private,
// ao lado deste). Sem o snapshot, a parte que depende dele e pulada.

const fs = require("fs"), zlib = require("zlib");
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'app.js'), "utf8").replace(/\r\n/g, '\n');

// extrai as tres funcoes puras do app.js e roda de verdade
let code = "";
for (const nome of ["isBlankPayload", "semHtml", "contarAulas"]) {
  const i = src.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("nao achei " + nome);
  const j = src.indexOf("\n}\n", i) + 3;
  code += src.slice(i, j) + "\n";
}
const api = eval("(function(){" + code + "return {isBlankPayload, contarAulas};})()");

const snapPath = process.env.LESSON_SNAPSHOT || path.resolve(RAIZ, '..', 'planejamento-migration-private', 'source-export-2026-09-03.json');
const snap = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')).payload : {lessonsByTeacher: {}};
const hasSnapshot = Object.keys(snap.lessonsByTeacher).length > 0;
const por = (tid) => Object.fromEntries((snap.lessonsByTeacher[tid] || []).map(r => [r.key, JSON.parse(r.json)]));
const raquel = por("prof-txf2grnxgpyxtr");
const soraia = por("prof-l7f85t4igq05d9");

let ok = true;
const checa = (cond, nome, extra) => {
  ok = ok && cond;
  console.log("  " + (cond ? "PASS  " : "FALHOU") + "  " + nome + (extra !== undefined ? "  ->  " + extra : ""));
};

console.log("--- isBlankPayload (true = vazio, bloqueia a gravacao) ---");
let r;
if(hasSnapshot){
r = api.isBlankPayload(raquel["2026-09-14_infantil_4"]);
checa(r === false, "Raquel 14/09, tem 1 aula: NAO pode ser considerada vazia", r);
r = api.isBlankPayload(raquel["2026-06-15_infantil_4"]);
checa(r === true, "Raquel 15/06, realmente vazia", r);
r = api.isBlankPayload(soraia["2026-08-03_3_ano"]);
checa(r === false, "Soraia 03/08, 22 aulas", r);
}

// o template exato que causou o acidente: unitDay preenchido, conteudo zero
const acidente = { rows: [{ unitDay: "B\u00cdLINGUE", conteudo: "", desenvolvimento: "", materiais: "", tarefas: "" }], coordMessage: "" };
r = api.isBlankPayload(acidente);
checa(r === true, "template do acidente (unitDay cheio, conteudo zero)", r);

// html vazio disfarcado, que e o que os campos rich text produzem
r = api.isBlankPayload({ rows: [{ conteudo: "<div><br></div>", desenvolvimento: "&nbsp; " }], coordMessage: "" });
checa(r === true, "html vazio disfarcado (<div><br></div>, &nbsp;)", r);

if(hasSnapshot){
  const n = api.contarAulas(soraia["2026-08-03_3_ano"]);
  checa(n === 22, "contarAulas(Soraia 03/08) = 22", n);
}

if(hasSnapshot){
console.log("\n--- gzip: ida e volta byte a byte, nas semanas reais ---");
let piorAntes = 0, piorDepois = 0, falhas = 0;
for (const linhas of Object.values(snap.lessonsByTeacher)) {
  for (const l of linhas) {
    const json = l.json || "";
    const b64 = "gz:" + zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 }).toString("base64");
    const volta = zlib.gunzipSync(Buffer.from(b64.slice(3), "base64")).toString("utf8");
    if (volta !== json) falhas++;
    piorAntes = Math.max(piorAntes, json.length);
    piorDepois = Math.max(piorDepois, b64.length < json.length ? b64.length : json.length);
  }
}
checa(falhas === 0, "round-trip identico em todas as semanas", falhas + " diferencas");
console.log("  maior celula: " + piorAntes + " -> " + piorDepois +
  "  (" + (100 * piorAntes / 50000).toFixed(1) + "% -> " + (100 * piorDepois / 50000).toFixed(1) + "% do limite)");
checa(piorDepois < 50000 * 0.5, "maior celula fica abaixo de 50% do limite");
}else{
  console.log('Snapshot privado ausente: verificacoes com dados reais nao executadas.');
}

console.log("\n" + (ok ? "TODOS OS TESTES PASSARAM" : "*** ALGO FALHOU ***"));
process.exit(ok ? 0 : 1);
