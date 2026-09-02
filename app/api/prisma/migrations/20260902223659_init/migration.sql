-- CreateEnum
CREATE TYPE "ClassLevel" AS ENUM ('infantil', 'fundamental');

-- CreateEnum
CREATE TYPE "AgendaTemplate" AS ENUM ('infantil', 'fundamental');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "Coordinator" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "googleSub" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coordinator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "photoUrl" TEXT,
    "isEnglishTeacher" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "magicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "ClassLevel" NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherClass" (
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,

    CONSTRAINT "TeacherClass_pkey" PRIMARY KEY ("teacherId","classId")
);

-- CreateTable
CREATE TABLE "LessonWeek" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "coordMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonDay" (
    "id" TEXT NOT NULL,
    "lessonWeekId" TEXT NOT NULL,
    "weekday" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "isRecess" BOOLEAN NOT NULL DEFAULT false,
    "unitDay" TEXT,
    "conteudo" TEXT,
    "desenvolvimento" TEXT,
    "materiais" TEXT,
    "tarefas" TEXT,
    "pppPresentation" TEXT,
    "pppPractice" TEXT,
    "pppProduction" TEXT,
    "skillListening" TEXT,
    "skillWriting" TEXT,
    "skillReading" TEXT,
    "skillSpeaking" TEXT,
    "agendaHtml" TEXT,
    "agendaGeneratedByAi" BOOLEAN NOT NULL DEFAULT false,
    "observations" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "html" TEXT,
    "color" TEXT NOT NULL DEFAULT '#dff4df',
    "isObservation" BOOLEAN NOT NULL DEFAULT false,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agenda" (
    "id" TEXT NOT NULL,
    "lessonWeekId" TEXT NOT NULL,
    "template" "AgendaTemplate" NOT NULL,
    "imageUrl" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "lessonDayId" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'pending',
    "prompt" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coordinator_email_key" ON "Coordinator"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Coordinator_googleSub_key" ON "Coordinator"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_magicToken_key" ON "Teacher"("magicToken");

-- CreateIndex
CREATE UNIQUE INDEX "Class_name_key" ON "Class"("name");

-- CreateIndex
CREATE INDEX "LessonWeek_weekStart_idx" ON "LessonWeek"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "LessonWeek_teacherId_classId_weekStart_key" ON "LessonWeek"("teacherId", "classId", "weekStart");

-- CreateIndex
CREATE INDEX "LessonDay_lessonWeekId_idx" ON "LessonDay"("lessonWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonDay_lessonWeekId_date_slot_key" ON "LessonDay"("lessonWeekId", "date", "slot");

-- CreateIndex
CREATE INDEX "CalendarEvent_date_idx" ON "CalendarEvent"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Agenda_lessonWeekId_key" ON "Agenda"("lessonWeekId");

-- CreateIndex
CREATE INDEX "AiJob_lessonDayId_idx" ON "AiJob"("lessonDayId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "TeacherClass" ADD CONSTRAINT "TeacherClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherClass" ADD CONSTRAINT "TeacherClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWeek" ADD CONSTRAINT "LessonWeek_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWeek" ADD CONSTRAINT "LessonWeek_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonDay" ADD CONSTRAINT "LessonDay_lessonWeekId_fkey" FOREIGN KEY ("lessonWeekId") REFERENCES "LessonWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_lessonWeekId_fkey" FOREIGN KEY ("lessonWeekId") REFERENCES "LessonWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
