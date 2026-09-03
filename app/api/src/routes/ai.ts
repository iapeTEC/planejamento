import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireTeacher } from "../lib/auth.js";

export const aiRouter = Router();

const AI_ENDPOINT = process.env.AI_ENDPOINT ?? "";
const AI_MODEL = process.env.AI_MODEL ?? "codex-luna-medium";

function buildPrompt(day: {
  unitDay: string | null;
  conteudo: string | null;
  desenvolvimento: string | null;
  tarefas: string | null;
}): string {
  // A Agenda já mostra "Disciplina: " como rótulo em negrito antes desse
  // texto (ver AgendaPage.tsx) — o modelo só precisa escrever o miolo do
  // bullet, puro texto, no estilo direto dos exemplos reais do colégio.
  return [
    "Você escreve o miolo de UM item da agenda semanal impressa que vai pros",
    "pais dos alunos, a partir do planejamento de aula abaixo. Esse texto",
    "aparece direto após o nome da disciplina (que já vem em negrito antes",
    "dele), então NUNCA repita a disciplina/unidade.",
    "",
    "Exemplos REAIS de como esse texto deve ficar (copie exatamente esse",
    "estilo, sem exceção):",
    '- "Ser honesto – Cap. 22."',
    '- "Sistemas de controle. Págs.: 139 e 140."',
    '- "Multiplicação de números decimais. Págs.: 197 e 198."',
    '- "Leitura complementar: A joaninha. Pág.: 45."',
    "",
    "Regras obrigatórias:",
    "- Responda em português, em UMA única linha, sem quebra de linha.",
    "- NUNCA use markdown: nada de **, *, -, #, listas ou títulos.",
    "- NUNCA use saudação, introdução ou explicação sobre o que você fez.",
    "- Seja telegráfico: conteúdo + página/capítulo quando houver, só isso.",
    "- Responda só com o texto final, nada antes nem depois.",
    "",
    `Disciplina/Unidade: ${day.unitDay || "-"}`,
    `Conteúdo: ${day.conteudo || "-"}`,
    `Desenvolvimento da aula: ${day.desenvolvimento || "-"}`,
    `Tarefa de casa: ${day.tarefas || "-"}`,
  ].join("\n");
}

/**
 * Chama o "codex-bridge" (serviço na própria VM, fora do Docker, que roda
 * `codex exec --model gpt-5.6-luna -c model_reasoning_effort=medium`) via
 * HTTP — só alcançável pela rede interna do Docker (172.21.0.1), nunca
 * exposto pra fora. Ver migration/NEXT_STEPS.md, Fase 5.
 */
async function callAiModel(prompt: string): Promise<string> {
  if (!AI_ENDPOINT) {
    throw new Error("AI_ENDPOINT não configurado — Codex ainda não instalado/ligado na VM.");
  }

  const resp = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, prompt }),
  });
  if (!resp.ok) throw new Error(`Falha ao chamar o modelo de IA (HTTP ${resp.status}).`);

  const data = (await resp.json()) as { text?: string };
  if (!data.text) throw new Error("Resposta da IA sem conteúdo.");
  return sanitizeAiText(data.text);
}

// Rede de segurança: mesmo com o prompt pedindo texto puro, o modelo às
// vezes devolve markdown ou várias linhas. Isso vai direto pro papel
// impresso da Agenda, então limpamos aqui.
function sanitizeAiText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^[-*#\s]+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .trim();
}

// POST /api/lesson-days/:id/agenda/generate — botão "Gerar por IA" da coluna Agenda.
aiRouter.post("/lesson-days/:id/agenda/generate", requireTeacher, async (req, res) => {
  const day = await prisma.lessonDay.findUnique({
    where: { id: req.params.id },
    include: { lessonWeek: { select: { teacherId: true } } },
  });
  if (!day) {
    res.status(404).json({ error: "Dia de planejamento não encontrado." });
    return;
  }
  if (day.lessonWeek.teacherId !== req.teacherId) {
    res.status(403).json({ error: "Acesso negado a este planejamento." });
    return;
  }

  const prompt = buildPrompt(day);
  const job = await prisma.aiJob.create({
    data: { lessonDayId: day.id, prompt, status: "running" },
  });

  try {
    const text = await callAiModel(prompt);
    await prisma.$transaction([
      prisma.aiJob.update({ where: { id: job.id }, data: { status: "done", result: text, finishedAt: new Date() } }),
      prisma.lessonDay.update({ where: { id: day.id }, data: { agendaHtml: text, agendaGeneratedByAi: true } }),
    ]);
    res.json({ jobId: job.id, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao gerar com IA.";
    await prisma.aiJob.update({ where: { id: job.id }, data: { status: "failed", error: message, finishedAt: new Date() } });
    // Nunca bloqueia o planejamento: a professora sempre pode preencher a Agenda manualmente.
    res.status(502).json({ error: message });
  }
});
