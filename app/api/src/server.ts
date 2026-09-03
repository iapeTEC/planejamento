import "dotenv/config";
import cors from "cors";
import express from "express";
import { agendasRouter } from "./routes/agendas.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { calendarEventsRouter } from "./routes/calendarEvents.js";
import { classesRouter } from "./routes/classes.js";
import { lessonWeeksRouter } from "./routes/lessonWeeks.js";
import { supervisorRouter } from "./routes/supervisor.js";
import { teachersRouter } from "./routes/teachers.js";

const app = express();
app.use(cors());
// 10mb pra caber o PNG do rabisco do Supervisor sem apertar.
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/teachers", teachersRouter);
app.use("/api/classes", classesRouter);
app.use("/api/lesson-weeks", lessonWeeksRouter);
app.use("/api/calendar-events", calendarEventsRouter);
app.use("/api/agendas", agendasRouter);
app.use("/api/supervisor", supervisorRouter);
app.use("/api", aiRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno." });
});

const port = Number(process.env.PORT ?? 3300);
app.listen(port, () => {
  console.log(`planejamento-api ouvindo em http://127.0.0.1:${port}`);
});
