import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { findCoordinatorBySession, isAdminEmail, verifyGoogleIdToken } from "../lib/auth.js";

export const authRouter = Router();

const loginInput = z.object({ idToken: z.string().min(1) });

// POST /api/auth/login — troca o ID token do Google (curto, ~1h) por uma
// sessão própria que só termina no logout explícito.
authRouter.post("/login", async (req, res) => {
  const parsed = loginInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const user = await verifyGoogleIdToken(parsed.data.idToken);
    if (!isAdminEmail(user.email)) {
      res.status(403).json({ error: "Acesso de coordenação obrigatório." });
      return;
    }

    const sessionToken = randomUUID();
    const coordinator = await prisma.coordinator.upsert({
      where: { email: user.email },
      create: { email: user.email, name: user.name, googleSub: user.sub, sessionToken },
      update: { name: user.name, googleSub: user.sub, sessionToken },
    });

    res.json({ sessionToken, email: coordinator.email, name: coordinator.name });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Falha no login." });
  }
});

// POST /api/auth/logout — invalida a sessão no servidor também, não só no navegador.
authRouter.post("/logout", async (req, res) => {
  const sessionToken = req.header("x-coordinator-session") ?? "";
  const user = await findCoordinatorBySession(sessionToken);
  if (user) {
    await prisma.coordinator.update({ where: { email: user.email }, data: { sessionToken: null } });
  }
  res.json({ ok: true });
});
