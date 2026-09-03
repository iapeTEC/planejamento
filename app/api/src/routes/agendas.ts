import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireTeacherOrCoordinator } from "../lib/auth.js";

export const agendasRouter = Router();

const agendaInput = z.object({
  template: z.enum(["infantil", "fundamental"]),
  imageUrl: z.string().url().nullable().optional(),
});

async function canAccessWeek(lessonWeekId: string, teacherId?: string): Promise<boolean> {
  if (!teacherId) return true;
  const week = await prisma.lessonWeek.findUnique({
    where: { id: lessonWeekId },
    select: { teacherId: true },
  });
  return week?.teacherId === teacherId;
}

// GET /api/agendas/:lessonWeekId
agendasRouter.get("/:lessonWeekId", requireTeacherOrCoordinator, async (req, res) => {
  if (!(await canAccessWeek(req.params.lessonWeekId, req.teacherId))) {
    res.status(403).json({ error: "Acesso negado a esta agenda." });
    return;
  }
  const agenda = await prisma.agenda.findUnique({
    where: { lessonWeekId: req.params.lessonWeekId },
    include: {
      lessonWeek: { include: { days: { orderBy: [{ date: "asc" }, { slot: "asc" }] }, teacher: true, class: true } },
    },
  });
  res.json(agenda);
});

// PUT /api/agendas/:lessonWeekId — cria/edita o registro da agenda (template, imagem do recado).
agendasRouter.put("/:lessonWeekId", requireTeacherOrCoordinator, async (req, res) => {
  const parsed = agendaInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await canAccessWeek(req.params.lessonWeekId, req.teacherId))) {
    res.status(403).json({ error: "Acesso negado a esta agenda." });
    return;
  }

  const updatedBy = req.coordinator?.email ?? req.teacherId ?? "desconhecido";
  const agenda = await prisma.agenda.upsert({
    where: { lessonWeekId: req.params.lessonWeekId },
    create: { lessonWeekId: req.params.lessonWeekId, updatedBy, ...parsed.data },
    update: { updatedBy, ...parsed.data },
  });

  res.json(agenda);
});

// POST /api/agendas/:lessonWeekId/pdf — gera o PDF a partir do template renderizado.
// TODO: implementar com Playwright renderizando o mesmo componente React da tela
// (ver ARCHITECTURE.md secao 7). Ainda nao implementado - devolve 501 de proposito
// em vez de fingir sucesso.
agendasRouter.post("/:lessonWeekId/pdf", requireTeacherOrCoordinator, async (req, res) => {
  if (!(await canAccessWeek(req.params.lessonWeekId, req.teacherId))) {
    res.status(403).json({ error: "Acesso negado a esta agenda." });
    return;
  }
  res.status(501).json({ error: "Geração de PDF ainda não implementada (Fase 4)." });
});
