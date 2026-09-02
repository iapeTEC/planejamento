import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { findTeacherByToken, isAdminEmail, verifyGoogleIdToken } from "../lib/auth.js";

export const agendasRouter = Router();

const agendaInput = z.object({
  template: z.enum(["infantil", "fundamental"]),
  imageUrl: z.string().url().optional(),
});

/** Aceita tanto o link mágico da professora quanto o login Google da coordenação. */
async function authAsTeacherOrCoordinator(req: Request, res: Response, next: NextFunction) {
  try {
    const teacherToken = req.header("x-teacher-token");
    if (teacherToken) {
      const teacher = await findTeacherByToken(teacherToken);
      if (!teacher) {
        res.status(401).json({ error: "Professor não cadastrado ou inativo." });
        return;
      }
      req.teacherId = teacher.id;
      next();
      return;
    }

    const authHeader = req.header("authorization") ?? "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) {
      res.status(401).json({ error: "Login do professor ou da coordenação obrigatório." });
      return;
    }

    const user = await verifyGoogleIdToken(idToken);
    if (!isAdminEmail(user.email)) {
      res.status(403).json({ error: "Acesso de coordenação obrigatório." });
      return;
    }

    req.coordinator = user;
    next();
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Falha na autenticação." });
  }
}

// GET /api/agendas/:lessonWeekId
agendasRouter.get("/:lessonWeekId", authAsTeacherOrCoordinator, async (req, res) => {
  const agenda = await prisma.agenda.findUnique({
    where: { lessonWeekId: req.params.lessonWeekId },
    include: {
      lessonWeek: { include: { days: { orderBy: [{ date: "asc" }, { slot: "asc" }] }, teacher: true, class: true } },
    },
  });
  res.json(agenda);
});

// PUT /api/agendas/:lessonWeekId — cria/edita o registro da agenda (template, imagem do recado).
agendasRouter.put("/:lessonWeekId", authAsTeacherOrCoordinator, async (req, res) => {
  const parsed = agendaInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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
agendasRouter.post("/:lessonWeekId/pdf", authAsTeacherOrCoordinator, async (_req, res) => {
  res.status(501).json({ error: "Geração de PDF ainda não implementada (Fase 4)." });
});
