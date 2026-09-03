-- Preserve source identities so the Google Sheets import can be rerun safely.
ALTER TABLE "Teacher" ADD COLUMN "legacyId" TEXT;
ALTER TABLE "LessonWeek" ADD COLUMN "legacyKey" TEXT;
ALTER TABLE "LessonWeek" ADD COLUMN "legacyUpdatedAt" TIMESTAMP(3);
ALTER TABLE "LessonWeek" ADD COLUMN "legacyUpdatedBy" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "legacyId" TEXT;

CREATE UNIQUE INDEX "Teacher_legacyId_key" ON "Teacher"("legacyId");
CREATE UNIQUE INDEX "LessonWeek_teacherId_legacyKey_key" ON "LessonWeek"("teacherId", "legacyKey");
CREATE UNIQUE INDEX "CalendarEvent_legacyId_key" ON "CalendarEvent"("legacyId");
