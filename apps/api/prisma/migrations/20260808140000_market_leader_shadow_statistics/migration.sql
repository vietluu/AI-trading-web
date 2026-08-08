ALTER TABLE "paper_signals" ADD COLUMN "configurationVersion" INTEGER;

CREATE INDEX "paper_signals_userId_mode_outcome_configurationVersion_createdAt_idx"
ON "paper_signals"("userId", "mode", "outcome", "configurationVersion", "createdAt");
