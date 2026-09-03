-- Versão estática/impressão pro Supervisor + rabisco salvo por cima.
CREATE TABLE "SupervisorNote" (
    "id" TEXT NOT NULL,
    "lessonWeekId" TEXT NOT NULL,
    "drawingDataUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupervisorNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupervisorNote_lessonWeekId_key" ON "SupervisorNote"("lessonWeekId");

ALTER TABLE "SupervisorNote" ADD CONSTRAINT "SupervisorNote_lessonWeekId_fkey" FOREIGN KEY ("lessonWeekId") REFERENCES "LessonWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
