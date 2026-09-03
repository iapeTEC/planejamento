// Ponte HTTP mínima entre o container da API (Docker) e o Codex instalado na
// própria VM (fora do Docker — o container não tem acesso ao binário nem às
// credenciais em ~/.codex). Só escuta na rede interna do Docker
// (planejamento_internal), nunca exposto pra fora da VM. Sem dependências
// externas de propósito, só módulos nativos do Node.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3301);
const HOST = process.env.HOST ?? "172.21.0.1"; // gateway da rede planejamento_internal
const MODEL = process.env.CODEX_MODEL ?? "gpt-5.6-luna";
const REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT ?? "medium";
const TIMEOUT_MS = 90_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function runCodex(prompt) {
  const dir = await mkdtemp(path.join(tmpdir(), "codex-bridge-"));
  const outFile = path.join(dir, "out.txt");
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(
        "codex",
        [
          "exec",
          "--model", MODEL,
          "-c", `model_reasoning_effort="${REASONING_EFFORT}"`,
          "--sandbox", "read-only",
          "--skip-git-repo-check",
          "--output-last-message", outFile,
          prompt,
        ],
        { timeout: TIMEOUT_MS, cwd: dir },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr?.slice(-500) || err.message));
          else resolve();
        },
      );
      // Sem isto, o stdin do processo filho fica como pipe aberto (nunca
      // fechado), e o codex trava esperando EOF em "Reading additional
      // input from stdin..." até nosso próprio TIMEOUT_MS matá-lo.
      child.stdin?.end();
      child.on("error", reject);
    });
    const text = (await readFile(outFile, "utf8")).trim();
    if (!text) throw new Error("Codex não retornou texto.");
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/generate") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "prompt vazio" }));
      return;
    }
    const text = await runCodex(prompt);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    console.error("codex-bridge error:", err);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`codex-bridge ouvindo em http://${HOST}:${PORT} (model=${MODEL}, effort=${REASONING_EFFORT})`);
});
