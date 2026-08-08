ALTER TABLE "paper_signals" ADD COLUMN "provider" "ExchangeProvider";

ALTER TABLE "self_learning_configurations"
  ADD COLUMN "liveVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "shadowVersion" INTEGER,
  ADD COLUMN "shadowStartedAt" TIMESTAMP(3),
  ADD COLUMN "lastPromotionAt" TIMESTAMP(3);

CREATE INDEX "paper_signals_userId_mode_outcome_createdAt_idx"
ON "paper_signals"("userId", "mode", "outcome", "createdAt");

CREATE INDEX "pipeline_runs_status_completedAt_idx"
ON "pipeline_runs"("status", "completedAt");

CREATE INDEX "pipeline_runs_userId_provider_symbol_status_createdAt_idx"
ON "pipeline_runs"("userId", "provider", "symbol", "status", "createdAt");

CREATE INDEX "performance_records_userId_horizon_evaluatedAt_idx"
ON "performance_records"("userId", "horizon", "evaluatedAt");

CREATE INDEX "market_candles_provider_symbol_isClosed_closeTime_idx"
ON "market_candles"("provider", "symbol", "isClosed", "closeTime");

CREATE INDEX "market_regime_states_symbol_detectedAt_idx"
ON "market_regime_states"("symbol", "detectedAt");
