-- Presença online/offline da professora, mostrada como bolinha verde/cinza
-- no dashboard da coordenadora.
ALTER TABLE "Teacher" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
