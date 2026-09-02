import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

interface GoogleUser {
  email: string;
  name: string;
  sub: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      coordinator?: GoogleUser;
      teacherId?: string;
    }
  }
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleUser> {
  const resp = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!resp.ok) throw new Error("Token do Google inválido.");

  const claims = (await resp.json()) as Record<string, string>;
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error("Token emitido para outro cliente.");
  if (claims.email_verified !== "true") throw new Error("Gmail não verificado.");

  return {
    email: String(claims.email ?? "").toLowerCase(),
    name: claims.name ?? "",
    sub: claims.sub ?? "",
  };
}

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Pure lookup, sem tocar em req/res — usada por rotas que aceitam professora OU coordenação. */
export async function findTeacherByToken(token: string) {
  if (!token) return null;
  const teacher = await prisma.teacher.findUnique({ where: { magicToken: token } });
  return teacher && teacher.active ? teacher : null;
}

/** Exige um Google ID token válido pertencente a um e-mail em ADMIN_EMAILS. */
export async function requireCoordinator(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.header("authorization") ?? "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) {
      res.status(401).json({ error: "Login do Google obrigatório." });
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

/** Exige um link mágico de professora válido, via header X-Teacher-Token. */
export async function requireTeacher(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.header("x-teacher-token") ?? "";
    if (!token) {
      res.status(401).json({ error: "Link do professor inválido." });
      return;
    }

    const teacher = await findTeacherByToken(token);
    if (!teacher) {
      res.status(401).json({ error: "Professor não cadastrado ou inativo." });
      return;
    }

    req.teacherId = teacher.id;
    next();
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Falha na autenticação." });
  }
}

/**
 * Aceita tanto o link mágico da professora quanto o login Google da
 * coordenação — usada nas rotas que a coordenadora também precisa poder
 * corrigir (planejamento e agenda), não só ver.
 */
export async function requireTeacherOrCoordinator(req: Request, res: Response, next: NextFunction) {
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
