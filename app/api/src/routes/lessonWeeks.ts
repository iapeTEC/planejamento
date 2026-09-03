import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireTeacher, requireTeacherOrCoordinator } from "../lib/auth.js";

export const lessonWeeksRouter = Router();

// .nullable() além de .optional(): o que volta do banco pra campos vazios é
// `null` (Prisma), não `undefined` — e a professora salva de volta o mesmo
// dia que acabou de carregar. Sem aceitar null aqui, qualquer save de uma
// semana com algum campo vazio (praticamente todas) dava 400.
const dayInput = z.object({
  weekday: z.string(),
  date: z.string(), // YYYY-MM-DD
  slot: z.number().int().default(0),
  isRecess: z.boolean().optional(),
  unitDay: z.string().nullable().optional(),
  conteudo: z.string().nullable().optional(),
  desenvolvimento: z.string().nullable().optional(),
  materiais: z.string().nullable().optional(),
  tarefas: z.string().nullable().optional(),
  pppPresentation: z.string().nullable().optional(),
  pppPractice: z.string().nullable().optional(),
  pppProduction: z.string().nullable().optional(),
  skillListening: z.string().nullable().optional(),
  skillWriting: z.string().nullable().optional(),
  skillReading: z.string().nullable().optional(),
  skillSpeaking: z.string().nullable().optional(),
  agendaHtml: z.string().nullable().optional(),
  agendaGeneratedByAi: z.boolean().optional(),
  observations: z.record(z.string(), z.string()).nullable().optional(),
});

const weekInput = z.object({
  classId: z.string().uuid(),
  term: z.string(),
  weekStart: z.string(), // YYYY-MM-DD (segunda-feira)
  coordMessage: z.string().nullable().optional(),
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

  const { classId, term, weekStart, coordMessage } = parsed.data;
  const teacherId = req.teacherId!;

  const [assignment, teacher] = await Promise.all([
    prisma.teacherClass.findUnique({ where: { teacherId_classId: { teacherId, classId } } }),
    prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, select: { isEnglishTeacher: true } }),
  ]);
  if (!assignment) {
    res.status(403).json({ error: "Turma não vinculada a este professor." });
    return;
  }

  // Turmas de inglês têm só 1 aula por dia — nunca deixa gravar slots extras
  // (aconteceu uma vez por engano na importação e deixou linhas vazias
  // fantasmas na tela).
  const days = teacher.isEnglishTeacher ? parsed.data.days.filter((day) => day.slot === 0) : parsed.data.days;

  const week = await prisma.$transaction(async (tx) => {
    const upserted = await tx.lessonWeek.upsert({
      where: {
        teacherId_classId_weekStart: { teacherId, classId, weekStart: new Date(weekStart) },
      },
      create: { teacherId, classId, term, weekStart: new Date(weekStart), coordMessage },
      update: { term, coordMessage },
    });

    for (const day of days) {
      // Prisma exige undefined (nao null) pra "nao mexer" num campo Json?.
      const { observations, ...dayRest } = day;
      const data = { ...dayRest, date: new Date(day.date), observations: observations ?? undefined };
      await tx.lessonDay.upsert({
        where: {
          lessonWeekId_date_slot: {
            lessonWeekId: upserted.id,
            date: new Date(day.date),
            slot: day.slot,
          },
        },
        create: { ...data, lessonWeekId: upserted.id },
        update: data,
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

  const { date, observations, ...rest } = parsed.data;
  const day = await prisma.lessonDay.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      ...(date ? { date: new Date(date) } : {}),
      ...(observations !== undefined ? { observations: observations ?? undefined } : {}),
    },
  });

  res.json(day);
});
