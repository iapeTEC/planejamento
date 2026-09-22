// Testa a validacao do botao Importar, rodando a funcao de verdade extraida
// do app.js. O que importa aqui: um arquivo de OUTRA turma ou de OUTRA semana
// tem que ser recusado — senao o conteudo entraria por cima da semana errada,
// que e a classe de acidente que apagou planejamentos em 18/09.
//
//   node migration/teste_import.js

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// Recorta lerArquivoImportado do app.js e roda com um makeKey() de mentira,
// para simular "a professora esta nesta semana/turma agora".
const ini = src.indexOf("async function lerArquivoImportado(");
if (ini < 0) throw new Error("nao achei lerArquivoImportado no app.js");
const corpo = src.slice(ini, src.indexOf("\n}\n", ini) + 3);

function comChaveAtual(chave) {
  return eval(
    "(function(){ const EXPORT_APP = 'planejamento-iape';" +
    " function makeKey(){ return " + JSON.stringify(chave) + "; }" +
    corpo +
    " return lerArquivoImportado; })()"
  );
}

const arquivo = (conteudo) => ({
  text: async () => (typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo)),
});

const valido = {
  app: "planejamento-iape",
  formato: 1,
  exportadoEm: "2026-09-22T17:10:00.000Z",
  key: "2026-09-14_infantil_4",
  teacherId: "prof-txf2grnxgpyxtr",
  professora: "Raquel",
  turma: "Infantil 4",
  semana: "2026-09-14",
  payload: { rows: [{ conteudo: "MEU MONSTRINHO DA RAIVA" }], coordMessage: "" },
};

let ok = true;

async function roda(chaveAtual, entrada) {
  try {
    await comChaveAtual(chaveAtual)(arquivo(entrada));
    return "ACEITOU";
  } catch (err) {
    return "recusou: " + err.message;
  }
}

const casos = [
  ["arquivo valido, turma e semana certas", "2026-09-14_infantil_4", valido,
    (r) => r === "ACEITOU"],
  ["texto que nao e JSON", "2026-09-14_infantil_4", "isto nao e json",
    (r) => r.includes("JSON")],
  ["JSON de outro sistema qualquer", "2026-09-14_infantil_4", { app: "outra-coisa", payload: { rows: [] } },
    (r) => r.includes("nao foi exportado")],
  ["arquivo sem as linhas do planejamento", "2026-09-14_infantil_4", { app: "planejamento-iape" },
    (r) => r.includes("linhas")],
  ["arquivo de OUTRA semana", "2026-09-21_infantil_4", valido,
    (r) => r.includes("Abra essa turma")],
  ["arquivo de OUTRA turma", "2026-09-14_3_ano", valido,
    (r) => r.includes("Abra essa turma")],
];

(async () => {
  for (const [nome, chaveAtual, entrada, valida] of casos) {
    const r = await roda(chaveAtual, entrada);
    const passou = valida(r);
    ok = ok && passou;
    console.log("  " + (passou ? "PASS  " : "FALHOU") + "  " + nome + "  ->  " + r.slice(0, 72));
  }
  console.log("\n" + (ok ? "TODOS OS TESTES PASSARAM" : "*** ALGO FALHOU ***"));
  process.exit(ok ? 0 : 1);
})();
