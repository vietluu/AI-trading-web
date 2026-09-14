-- CreateTable
CREATE TABLE "shadow_execution_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evaluationKey" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "setup" TEXT NOT NULL,
    "cohortKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "entryPrice" DECIMAL(24,8) NOT NULL,
    "stopLoss" DECIMAL(24,8) NOT NULL,
    "targets" JSONB NOT NULL,
    "quantity" DECIMAL(30,12),
    "riskFraction" DECIMAL(10,4),
    "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "feeBps" DECIMAL(10,4) NOT NULL,
    "slippageBps" DECIMAL(10,4) NOT NULL,
    "fundingBps" DECIMAL(10,4) NOT NULL,
    "grossPnl" DECIMAL(24,8),
    "netPnl" DECIMAL(24,8),
    "netR" DECIMAL(24,8),
    "mfe" DECIMAL(24,8),
    "mae" DECIMAL(24,8),
    "durationCandles" INTEGER,
    "terminalReason" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "configurationHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shadow_execution_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shadow_execution_plans_evaluationKey_key" ON "shadow_execution_plans"("evaluationKey");

-- CreateIndex
CREATE INDEX "shadow_execution_plans_symbol_timeframe_sourceDataCutoff_idx" ON "shadow_execution_plans"("symbol", "timeframe", "sourceDataCutoff");

-- CreateIndex
CREATE INDEX "shadow_execution_plans_cohortKey_idx" ON "shadow_execution_plans"("cohortKey");

-- CreateIndex
CREATE INDEX "shadow_execution_plans_status_isComplete_idx" ON "shadow_execution_plans"("status", "isComplete");
