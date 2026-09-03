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
  return [
    "Escreva o texto da Agenda semanal para os pais, no estilo direto e",
    "acolhedor usado pelo colégio (bullets por disciplina, sem jargão técnico),",
    "a partir deste planejamento do dia:",
    `Disciplina/Unidade: ${day.unitDay ?? "-"}`,
    `Conteúdo: ${day.conteudo ?? "-"}`,
    `Desenvolvimento da aula: ${day.desenvolvimento ?? "-"}`,
    `Tarefa de casa: ${day.tarefas ?? "-"}`,
  ].join("\n");
}

/**
 * Chama o Codex rodando na VM iape. Ainda não conectado de verdade — falta o
 * Codex ser instalado na VM e a forma de invocação (CLI via SSH ou HTTP) ser
 * definida. Ver migration/NEXT_STEPS.md, Fase 5.
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
  return data.text;
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
