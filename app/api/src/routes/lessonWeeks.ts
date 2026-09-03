import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireTeacher, requireTeacherOrCoordinator } from "../lib/auth.js";

export const lessonWeeksRouter = Router();

const dayInput = z.object({
  weekday: z.string(),
  date: z.string(), // YYYY-MM-DD
  slot: z.number().int().default(0),
  isRecess: z.boolean().optional(),
  unitDay: z.string().optional(),
  conteudo: z.string().optional(),
  desenvolvimento: z.string().optional(),
  materiais: z.string().optional(),
  tarefas: z.string().optional(),
  pppPresentation: z.string().optional(),
  pppPractice: z.string().optional(),
  pppProduction: z.string().optional(),
  skillListening: z.string().optional(),
  skillWriting: z.string().optional(),
  skillReading: z.string().optional(),
  skillSpeaking: z.string().optional(),
  observations: z.record(z.string(), z.string()).optional(),
});

const weekInput = z.object({
  classId: z.string().uuid(),
  term: z.string(),
  weekStart: z.string(), // YYYY-MM-DD (segunda-feira)
  coordMessage: z.string().optional(),
  days: z.array(dayInput),
});

// GET /api/lesson-weeks?classId=&weekStart=  (escopo: a própria professora do link mágico)
lessonWeeksRouter.get("/", requireTeacher, async (req, res) => {
  const classId = String(req.query.classId ?? "");
  const weekStart = String(req.query.weekStart ?? "");
  if (!classId || !weekStart) {
    res.status(400).json({ error: "classId e weekStart são obrigatórios." });
    return;
  }

  const week = await prisma.lessonWeek.findUnique({
    where: {
      teacherId_classId_weekStart: {
        teacherId: req.teacherId!,
        classId,
        weekStart: new Date(weekStart),
      },
    },
    include: { days: { orderBy: [{ date: "asc" }, { slot: "asc" }] } },
  });

  res.json(week);
});

// PUT /api/lesson-weeks — upsert da semana inteira (usado pelo autosave: debounce + blur + botão Salvar).
lessonWeeksRouter.put("/", requireTeacher, async (req, res) => {
  const parsed = weekInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { classId, term, weekStart, coordMessage, days } = parsed.data;
  const teacherId = req.teacherId!;

  const assignment = await prisma.teacherClass.findUnique({
    where: { teacherId_classId: { teacherId, classId } },
  });
  if (!assignment) {
    res.status(403).json({ error: "Turma não vinculada a este professor." });
    return;
  }

  const week = await prisma.$transaction(async (tx) => {
    const upserted = await tx.lessonWeek.upsert({
      where: {
        teacherId_classId_weekStart: { teacherId, classId, weekStart: new Date(weekStart) },
      },
      create: { teacherId, classId, term, weekStart: new Date(weekStart), coordMessage },
      update: { term, coordMessage },
    });

    for (const day of days) {
      await tx.lessonDay.upsert({
        where: {
          lessonWeekId_date_slot: {
            lessonWeekId: upserted.id,
            date: new Date(day.date),
            slot: day.slot,
          },
        },
        create: { ...day, date: new Date(day.date), lessonWeekId: upserted.id },
        update: { ...day, date: new Date(day.date) },
      });
    }

    return tx.lessonWeek.findUniqueOrThrow({
      where: { id: upserted.id },
      include: { days: { orderBy: [{ date: "asc" }, { slot: "asc" }] } },
    });
  });

  res.json(week);
});

// PATCH /api/lesson-days/:id — autosave granular de um campo/dia específico.
// Aceita professora (link mágico) OU coordenação (correção direta na Agenda/Planejamento).
lessonWeeksRouter.patch("/days/:id", requireTeacherOrCoordinator, async (req, res) => {
  const parsed = dayInput.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await prisma.lessonDay.findUnique({
    where: { id: req.params.id },
    include: { lessonWeek: { select: { teacherId: true } } },
  });
  if (!current) {
    res.status(404).json({ error: "Dia de planejamento não encontrado." });
    return;
  }
  if (req.teacherId && current.lessonWeek.teacherId !== req.teacherId) {
    res.status(403).json({ error: "Acesso negado a este planejamento." });
    return;
  }

  const { date, ...rest } = parsed.data;
  const day = await prisma.lessonDay.update({
    where: { id: req.params.id },
    data: { ...rest, ...(date ? { date: new Date(date) } : {}) },
  });

  res.json(day);
});
