ALTER TABLE "research_validation_runs"
ADD COLUMN "strategyKey" TEXT NOT NULL DEFAULT 'ai-core';

CREATE INDEX "research_validation_runs_userId_strategyKey_symbol_provider_interval_createdAt_idx"
ON "research_validation_runs"("userId", "strategyKey", "symbol", "provider", "interval", "createdAt");
