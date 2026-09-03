import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireTeacherOrCoordinator } from "../lib/auth.js";

export const supervisorRouter = Router();

// GET /api/supervisor/:lessonWeekId — versão só-leitura pronta pra impressão
// (o "Advisor" do sistema antigo), com o rabisco salvo (se houver).
supervisorRouter.get("/:lessonWeekId", requireTeacherOrCoordinator, async (req, res) => {
  const week = await prisma.lessonWeek.findUnique({
    where: { id: req.params.lessonWeekId },
    include: {
      teacher: { select: { name: true, isEnglishTeacher: true } },
      class: { select: { name: true } },
      days: { orderBy: [{ date: "asc" }, { slot: "asc" }] },
      supervisorNote: true,
    },
  });
  if (!week) {
    res.status(404).json({ error: "Planejamento não encontrado." });
    return;
  }
  if (req.teacherId && week.teacherId !== req.teacherId) {
    res.status(403).json({ error: "Acesso negado a este planejamento." });
    return;
  }
  res.json(week);
});

const noteInput = z.object({ drawingDataUrl: z.string().nullable() });

// PUT /api/supervisor/:lessonWeekId/note — salva o rabisco (imagem) por cima da versão estática.
supervisorRouter.put("/:lessonWeekId/note", requireTeacherOrCoordinator, async (req, res) => {
  const parsed = noteInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const week = await prisma.lessonWeek.findUnique({ where: { id: req.params.lessonWeekId } });
  if (!week) {
    res.status(404).json({ error: "Planejamento não encontrado." });
    return;
  }
  if (req.teacherId && week.teacherId !== req.teacherId) {
    res.status(403).json({ error: "Acesso negado a este planejamento." });
    return;
  }

  const note = await prisma.supervisorNote.upsert({
    where: { lessonWeekId: req.params.lessonWeekId },
    create: { lessonWeekId: req.params.lessonWeekId, drawingDataUrl: parsed.data.drawingDataUrl },
    update: { drawingDataUrl: parsed.data.drawingDataUrl },
  });

  res.json(note);
});
