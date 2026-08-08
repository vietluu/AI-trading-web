ALTER TABLE "risk_assessments"
  ADD COLUMN "tradePlan" JSONB;

ALTER TABLE "live_orders"
  ADD COLUMN "initialStopLoss" DECIMAL(24,8),
  ADD COLUMN "highestMark" DECIMAL(24,8),
  ADD COLUMN "lowestMark" DECIMAL(24,8),
  ADD COLUMN "protectiveClientOrderId" TEXT,
  ADD COLUMN "tradePlan" JSONB,
  ADD COLUMN "partialTakenAt" TIMESTAMP(3);
