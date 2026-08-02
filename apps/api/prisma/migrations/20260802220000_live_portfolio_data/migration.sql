ALTER TABLE "risk_assessments" ADD COLUMN "strategyId" UUID;
ALTER TABLE "live_orders" ADD COLUMN "strategyId" UUID;
ALTER TABLE "live_positions" ADD COLUMN "strategyId" UUID;
ALTER TABLE "live_positions" ADD COLUMN "realizedPnl" DECIMAL(24,8);

CREATE INDEX "risk_assessments_strategyId_createdAt_idx" ON "risk_assessments"("strategyId", "createdAt");
CREATE INDEX "live_orders_strategyId_createdAt_idx" ON "live_orders"("strategyId", "createdAt");
CREATE INDEX "live_positions_strategyId_syncedAt_idx" ON "live_positions"("strategyId", "syncedAt");

ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "live_orders" ADD CONSTRAINT "live_orders_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "live_positions" ADD CONSTRAINT "live_positions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
