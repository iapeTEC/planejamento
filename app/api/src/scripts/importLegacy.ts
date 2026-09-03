import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient, type ClassLevel } from "@prisma/client";

const prisma = new PrismaClient();

interface LegacyTeacher {
  teacherId: string;
  name: string;
  classes: string;
  active: boolean;
  createdAt?: string;
  isEnglishTeacher: boolean;
}

interface LegacyLesson {
  key: string;
  json: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface LegacyCalendarEvent {
  eventId: string;
  date: string;
  title: string;
  html?: string;
  color?: string;
  isObservation?: boolean;
  importId?: string;
  createdAt?: string;
}

interface LegacyRow {
  weekday?: unknown;
  date?: unknown;
  slot?: unknown;
  localRecess?: unknown;
  unitDay?: unknown;
  conteudo?: unknown;
  desenvolvimento?: unknown;
  materiais?: unknown;
  tarefas?: unknown;
  observations?: unknown;
}

interface LegacyPayload {
  className?: unknown;
  term?: unknown;
  weekStart?: unknown;
  coordMessage?: unknown;
  rows?: unknown;
}

interface ExportFile {
  ok: boolean;
  payload: {
    teachers: LegacyTeacher[];
    calendarEvents: LegacyCalendarEvent[];
    lessonsByTeacher: Record<string, LegacyLesson[] | { error: string }>;
  };
}

interface PreparedLesson {
  legacyTeacherId: string;
  legacyKey: string;
  className: string;
  term: string;
  weekStart: string;
  coordMessage: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  rows: LegacyRow[];
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result === "" ? null : result;
}

function booleanValue(value: unknown): boolean {
  return value === true || ["true", "sim", "yes", "1"].includes(text(value).trim().toLowerCase());
}

function classNames(value: unknown): string[] {
  return text(value)
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function classLevel(name: string): ClassLevel {
  return /^infantil\b/i.test(name) ? "infantil" : "fundamental";
}

function isoDate(value: unknown, label: string): string {
  const result = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error(`${label}: data inválida (${text(value)})`);
  }
  return result;
}

function dbDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function optionalDate(value: unknown): Date | null {
  if (!value) return null;
  const result = new Date(text(value));
  return Number.isNaN(result.getTime()) ? null : result;
}

function parsePayload(lesson: LegacyLesson): LegacyPayload {
  const parsed = JSON.parse(lesson.json) as LegacyPayload;
  if (!parsed || typeof parsed !== "object") throw new Error(`JSON vazio em ${lesson.key}`);
  return parsed;
}

function prepare(source: ExportFile) {
  if (!source.ok || !source.payload) throw new Error("Snapshot de origem inválido.");

  const warnings: string[] = [];
  const errors: string[] = [];
  const prepared = new Map<string, PreparedLesson>();
  let rawLessonRows = 0;

  for (const teacher of source.payload.teachers) {
    const group = source.payload.lessonsByTeacher[teacher.teacherId];
    if (!Array.isArray(group)) {
      errors.push(`Falha na planilha de um docente: ${group?.error ?? "grupo ausente"}`);
      continue;
    }
    rawLessonRows += group.length;

    for (const lesson of group) {
      try {
        const payload = parsePayload(lesson);
        const className = text(payload.className).trim();
        if (!className) throw new Error(`Turma ausente em ${lesson.key}`);
        const fallbackWeek = lesson.key.match(/(?:^|_)\d{4}-\d{2}-\d{2}/)?.[0].replace(/^_/, "");
        const weekStart = isoDate(payload.weekStart || fallbackWeek, `Semana ${lesson.key}`);
        const rows = Array.isArray(payload.rows) ? (payload.rows as LegacyRow[]) : [];
        const item: PreparedLesson = {
          legacyTeacherId: teacher.teacherId,
          legacyKey: lesson.key,
          className,
          term: text(payload.term || "1"),
          weekStart,
          coordMessage: nullableText(payload.coordMessage),
          updatedAt: optionalDate(lesson.updatedAt),
          updatedBy: nullableText(lesson.updatedBy),
          rows,
        };
        const logicalKey = `${teacher.teacherId}\u0000${className}\u0000${weekStart}`;
        const prior = prepared.get(logicalKey);
        if (prior) {
          warnings.push("Planejamento duplicado: mantida a versão mais recente.");
          if ((prior.updatedAt?.getTime() ?? 0) > (item.updatedAt?.getTime() ?? 0)) continue;
        }
        prepared.set(logicalKey, item);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const teacherIds = source.payload.teachers.map((teacher) => teacher.teacherId);
  if (new Set(teacherIds).size !== teacherIds.length) errors.push("teacherId duplicado na origem.");

  return { lessons: [...prepared.values()], rawLessonRows, warnings, errors };
}

function preparedRows(lesson: PreparedLesson) {
  const nextSlot = new Map<string, number>();
  const seen = new Set<string>();
  return lesson.rows.map((row, index) => {
    const date = isoDate(row.date, `Linha ${index + 1} de ${lesson.legacyKey}`);
    const explicit = Number(row.slot);
    const slot = Number.isInteger(explicit) && explicit >= 0 ? explicit : nextSlot.get(date) ?? 0;
    nextSlot.set(date, Math.max(nextSlot.get(date) ?? 0, slot + 1));
    const identity = `${date}\u0000${slot}`;
    if (seen.has(identity)) throw new Error(`Slot duplicado em ${lesson.legacyKey}: ${date}/${slot}`);
    seen.add(identity);

    const observations = row.observations == null
      ? undefined
      : (row.observations as Prisma.InputJsonValue);
    return {
      weekday: text(row.weekday),
      date,
      slot,
      isRecess: booleanValue(row.localRecess),
      unitDay: nullableText(row.unitDay),
      conteudo: nullableText(row.conteudo),
      desenvolvimento: nullableText(row.desenvolvimento),
      materiais: nullableText(row.materiais),
      tarefas: nullableText(row.tarefas),
      observations,
    };
  });
}

async function applyImport(source: ExportFile, lessons: PreparedLesson[]) {
  return prisma.$transaction(async (tx) => {
    const classMap = new Map<string, { id: string; level: ClassLevel }>();
    const allClasses = new Set<string>();
    for (const teacher of source.payload.teachers) classNames(teacher.classes).forEach((name) => allClasses.add(name));
    lessons.forEach((lesson) => allClasses.add(lesson.className));

    for (const name of [...allClasses].sort()) {
      const level = classLevel(name);
      const row = await tx.class.upsert({ where: { name }, create: { name, level }, update: { level } });
      classMap.set(name, row);
    }

    const teacherMap = new Map<string, string>();
    let rotatedLegacyTokens = 0;
    for (const sourceTeacher of source.payload.teachers) {
      const existing = await tx.teacher.findUnique({ where: { legacyId: sourceTeacher.teacherId } });
      const safeLegacyToken = /^prof-[0-9a-f]{16}$/i.test(sourceTeacher.teacherId);
      if (!safeLegacyToken && !existing) rotatedLegacyTokens += 1;
      const teacher = await tx.teacher.upsert({
        where: { legacyId: sourceTeacher.teacherId },
        create: {
          legacyId: sourceTeacher.teacherId,
          name: sourceTeacher.name,
          active: booleanValue(sourceTeacher.active),
          isEnglishTeacher: booleanValue(sourceTeacher.isEnglishTeacher),
          magicToken: safeLegacyToken ? sourceTeacher.teacherId : randomUUID(),
          ...(optionalDate(sourceTeacher.createdAt) ? { createdAt: optionalDate(sourceTeacher.createdAt)! } : {}),
        },
        update: {
          name: sourceTeacher.name,
          active: booleanValue(sourceTeacher.active),
          isEnglishTeacher: booleanValue(sourceTeacher.isEnglishTeacher),
        },
      });
      teacherMap.set(sourceTeacher.teacherId, teacher.id);

      const assigned = new Set(classNames(sourceTeacher.classes));
      lessons.filter((lesson) => lesson.legacyTeacherId === sourceTeacher.teacherId)
        .forEach((lesson) => assigned.add(lesson.className));
      for (const name of assigned) {
        await tx.teacherClass.upsert({
          where: { teacherId_classId: { teacherId: teacher.id, classId: classMap.get(name)!.id } },
          create: { teacherId: teacher.id, classId: classMap.get(name)!.id },
          update: {},
        });
      }
    }

    let dayCount = 0;
    for (const sourceLesson of lessons) {
      const teacherId = teacherMap.get(sourceLesson.legacyTeacherId)!;
      const classRow = classMap.get(sourceLesson.className)!;
      const week = await tx.lessonWeek.upsert({
        where: {
          teacherId_classId_weekStart: {
            teacherId,
            classId: classRow.id,
            weekStart: dbDate(sourceLesson.weekStart),
          },
        },
        create: {
          teacherId,
          classId: classRow.id,
          legacyKey: sourceLesson.legacyKey,
          legacyUpdatedAt: sourceLesson.updatedAt,
          legacyUpdatedBy: sourceLesson.updatedBy,
          term: sourceLesson.term,
          weekStart: dbDate(sourceLesson.weekStart),
          coordMessage: sourceLesson.coordMessage,
        },
        update: {
          legacyKey: sourceLesson.legacyKey,
          legacyUpdatedAt: sourceLesson.updatedAt,
          legacyUpdatedBy: sourceLesson.updatedBy,
          term: sourceLesson.term,
          coordMessage: sourceLesson.coordMessage,
        },
      });

      for (const row of preparedRows(sourceLesson)) {
        await tx.lessonDay.upsert({
          where: { lessonWeekId_date_slot: { lessonWeekId: week.id, date: dbDate(row.date), slot: row.slot } },
          create: { ...row, date: dbDate(row.date), lessonWeekId: week.id },
          update: { ...row, date: dbDate(row.date) },
        });
        dayCount += 1;
      }
      await tx.agenda.upsert({
        where: { lessonWeekId: week.id },
        create: { lessonWeekId: week.id, template: classRow.level },
        update: {},
      });
    }

    for (const event of source.payload.calendarEvents) {
      await tx.calendarEvent.upsert({
        where: { legacyId: event.eventId },
        create: {
          legacyId: event.eventId,
          date: dbDate(isoDate(event.date, `Evento ${event.eventId}`)),
          title: event.title,
          html: nullableText(event.html),
          color: event.color || "#dff4df",
          isObservation: booleanValue(event.isObservation),
          importId: nullableText(event.importId),
          ...(optionalDate(event.createdAt) ? { createdAt: optionalDate(event.createdAt)! } : {}),
        },
        update: {
          date: dbDate(isoDate(event.date, `Evento ${event.eventId}`)),
          title: event.title,
          html: nullableText(event.html),
          color: event.color || "#dff4df",
          isObservation: booleanValue(event.isObservation),
          importId: nullableText(event.importId),
        },
      });
    }

    return { dayCount, rotatedLegacyTokens };
  }, { timeout: 120_000 });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const offline = args.includes("--offline");
  const sourcePath = args.find((arg) => !arg.startsWith("--"));
  if (!sourcePath) throw new Error("Uso: legacy:import <snapshot.json> [--apply]");
  if (apply && offline) throw new Error("--apply e --offline não podem ser usados juntos.");

  const raw = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const source = JSON.parse(raw.toString("utf8")) as ExportFile;
  const prepared = prepare(source);
  const preparedDayCount = prepared.lessons.reduce((sum, lesson) => sum + preparedRows(lesson).length, 0);

  const before = offline ? null : {
      teachers: await prisma.teacher.count(),
      lessonWeeks: await prisma.lessonWeek.count(),
      lessonDays: await prisma.lessonDay.count(),
      calendarEvents: await prisma.calendarEvent.count(),
    };

  const report: Record<string, unknown> = {
    mode: apply ? "apply" : "dry-run",
    sourceSha256: sha256,
    source: {
      teachers: source.payload.teachers.length,
      rawLessonRows: prepared.rawLessonRows,
      logicalLessonWeeks: prepared.lessons.length,
      lessonDays: preparedDayCount,
      calendarEvents: source.payload.calendarEvents.length,
    },
    warnings: prepared.warnings,
    errors: prepared.errors,
    ...(before ? { databaseBefore: before } : {}),
  };

  if (prepared.errors.length) throw new Error(JSON.stringify(report, null, 2));
  if (apply) {
    report.applied = await applyImport(source, prepared.lessons);
    report.databaseAfter = {
      teachers: await prisma.teacher.count(),
      legacyTeachers: await prisma.teacher.count({ where: { legacyId: { not: null } } }),
      lessonWeeks: await prisma.lessonWeek.count(),
      legacyLessonWeeks: await prisma.lessonWeek.count({ where: { legacyKey: { not: null } } }),
      lessonDays: await prisma.lessonDay.count(),
      agendas: await prisma.agenda.count(),
      calendarEvents: await prisma.calendarEvent.count(),
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
