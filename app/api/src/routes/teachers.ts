import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireCoordinator, requireTeacher } from "../lib/auth.js";

export const teachersRouter = Router();

const teacherInput = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  isEnglishTeacher: z.boolean().optional(),
  active: z.boolean().optional(),
  classIds: z.array(z.string().uuid()).min(1),
});

// GET /api/teachers — lista completa, só coordenação.
teachersRouter.get("/", requireCoordinator, async (_req, res) => {
  const teachers = await prisma.teacher.findMany({
    include: { classes: { include: { class: true } } },
    orderBy: { name: "asc" },
  });
  res.json(teachers);
});

// POST /api/teachers — cadastra professora nova.
teachersRouter.post("/", requireCoordinator, async (req, res) => {
  const parsed = teacherInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { classIds, ...data } = parsed.data;
  const teacher = await prisma.teacher.create({
    data: {
      ...data,
      classes: { create: classIds.map((classId) => ({ classId })) },
    },
    include: { classes: { include: { class: true } } },
  });

  res.status(201).json(teacher);
});

// PATCH /api/teachers/:id — edita cadastro (nome, telefone, foto, turmas, ativo).
teachersRouter.patch("/:id", requireCoordinator, async (req, res) => {
  const parsed = teacherInput.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { classIds, ...data } = parsed.data;

  const teacher = await prisma.$transaction(async (tx) => {
    if (classIds) {
      await tx.teacherClass.deleteMany({ where: { teacherId: req.params.id } });
      await tx.teacherClass.createMany({
        data: classIds.map((classId) => ({ teacherId: req.params.id, classId })),
      });
    }
    return tx.teacher.update({
      where: { id: req.params.id },
      data,
      include: { classes: { include: { class: true } } },
    });
  });

  res.json(teacher);
});

// DELETE /api/teachers/:id
teachersRouter.delete("/:id", requireCoordinator, async (req, res) => {
  await prisma.teacher.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// GET /api/teachers/me — usado pela professora (link mágico) pra carregar o próprio perfil.
teachersRouter.get("/me", requireTeacher, async (req, res) => {
  const teacher = await prisma.teacher.findUnique({
    where: { id: req.teacherId },
    include: { classes: { include: { class: true } } },
  });
  res.json(teacher);
});

// POST /api/teachers/heartbeat — a tela da professora chama isso periodicamente
// enquanto está aberta. Alimenta a bolinha verde/cinza (online/offline) no
// dashboard da coordenadora, pra ela evitar editar em cima de quem está com a
// página aberta naquele momento.
teachersRouter.post("/heartbeat", requireTeacher, async (req, res) => {
  await prisma.teacher.update({
    where: { id: req.teacherId },
    data: { lastSeenAt: new Date() },
  });
  res.json({ ok: true });
});
