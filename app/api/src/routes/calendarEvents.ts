import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireCoordinator } from "../lib/auth.js";

export const calendarEventsRouter = Router();

const eventInput = z.object({
  date: z.string(), // YYYY-MM-DD
  title: z.string().min(1),
  html: z.string().optional(),
  color: z.string().optional(),
  isObservation: z.boolean().optional(),
  importId: z.string().optional(),
});

// GET /api/calendar-events — lido por professoras e coordenação (sem dado sensível).
calendarEventsRouter.get("/", async (_req, res) => {
  const events = await prisma.calendarEvent.findMany({ orderBy: [{ date: "asc" }, { title: "asc" }] });
  res.json(events);
});

// POST /api/calendar-events — só coordenação.
calendarEventsRouter.post("/", requireCoordinator, async (req, res) => {
  const parsed = eventInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { date, ...rest } = parsed.data;
  const event = await prisma.calendarEvent.create({ data: { ...rest, date: new Date(date) } });
  res.status(201).json(event);
});

// DELETE /api/calendar-events/:id — só coordenação.
calendarEventsRouter.delete("/:id", requireCoordinator, async (req, res) => {
  await prisma.calendarEvent.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
