ALTER TABLE "market_regime_states"
ADD COLUMN "provider" TEXT,
ADD COLUMN "interval" TEXT;

CREATE INDEX "market_regime_states_symbol_provider_interval_detectedAt_idx"
ON "market_regime_states"("symbol", "provider", "interval", "detectedAt");
