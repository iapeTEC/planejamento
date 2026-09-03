-- Sessão de coordenação própria: token opaco que não expira sozinho (só no
-- logout explícito), pra não depender do ID token do Google (~1h de validade).
ALTER TABLE "Coordinator" ADD COLUMN "sessionToken" TEXT;
CREATE UNIQUE INDEX "Coordinator_sessionToken_key" ON "Coordinator"("sessionToken");
