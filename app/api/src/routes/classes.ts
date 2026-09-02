import { Router } from "express";
import { prisma } from "../lib/db.js";

export const classesRouter = Router();

// GET /api/classes — lista simples de turmas (autenticação não é sensível aqui).
classesRouter.get("/", async (_req, res) => {
  const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
  res.json(classes);
});
