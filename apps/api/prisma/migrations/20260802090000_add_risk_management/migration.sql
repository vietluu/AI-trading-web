ALTER TABLE "paper_positions"
  ADD COLUMN "stopLoss" DECIMAL(24,8),
  ADD COLUMN "takeProfit" DECIMAL(24,8);

UPDATE "paper_positions"
SET
  "stopLoss" = CASE WHEN "side" = 'LONG' THEN "entryPrice" * 0.98 ELSE "entryPrice" * 1.02 END,
  "takeProfit" = CASE WHEN "side" = 'LONG' THEN "entryPrice" * 1.04 ELSE "entryPrice" * 0.96 END;

ALTER TABLE "paper_positions"
  ALTER COLUMN "stopLoss" SET NOT NULL,
  ALTER COLUMN "takeProfit" SET NOT NULL;

CREATE TABLE "risk_assessments" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "pipelineRunId" UUID,
  "symbol" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "reason" TEXT,
  "positionSize" DECIMAL(30,12),
  "leverage" INTEGER,
  "stopLoss" DECIMAL(24,8),
  "takeProfit" DECIMAL(24,8),
  "riskScore" DOUBLE PRECISION NOT NULL,
  "referencePrice" DECIMAL(24,8) NOT NULL,
  "volatility" DOUBLE PRECISION NOT NULL,
  "exposurePct" DOUBLE PRECISION NOT NULL,
  "drawdownPct" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risk_assessments_pipelineRunId_key" ON "risk_assessments"("pipelineRunId");
CREATE INDEX "risk_assessments_userId_createdAt_idx" ON "risk_assessments"("userId", "createdAt");
CREATE INDEX "risk_assessments_userId_approved_createdAt_idx" ON "risk_assessments"("userId", "approved", "createdAt");
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
