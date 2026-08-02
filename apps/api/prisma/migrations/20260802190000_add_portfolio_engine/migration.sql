CREATE TYPE "StrategyType" AS ENUM ('AI', 'RULE_BASED', 'HYBRID');
CREATE TYPE "StrategyKind" AS ENUM ('AI_CORE', 'TREND_FOLLOWING', 'MEAN_REVERSION', 'BREAKOUT', 'NEWS_DRIVEN');
CREATE TYPE "StrategyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

ALTER TABLE "pipeline_schedules" ADD COLUMN "strategyIds" TEXT[] NOT NULL DEFAULT ARRAY['ai-core']::TEXT[];
ALTER TABLE "paper_positions" ADD COLUMN "strategyId" UUID;

CREATE TABLE "portfolio_strategies" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "StrategyType" NOT NULL,
  "kind" "StrategyKind" NOT NULL,
  "symbols" TEXT[] NOT NULL,
  "status" "StrategyStatus" NOT NULL DEFAULT 'ACTIVE',
  "disabledReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "portfolio_strategies_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "strategy_allocations" (
  "id" UUID NOT NULL,
  "strategyId" UUID NOT NULL,
  "allocatedCapital" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "weight" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "strategy_allocations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "strategy_performance" (
  "id" UUID NOT NULL,
  "strategyId" UUID NOT NULL,
  "totalTrades" INTEGER NOT NULL DEFAULT 0,
  "winningTrades" INTEGER NOT NULL DEFAULT 0,
  "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "returnPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "drawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharpeRatio" DOUBLE PRECISION,
  "realizedPnl" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "strategy_performance_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "strategy_positions" (
  "id" UUID NOT NULL,
  "strategyId" UUID NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "quantity" DECIMAL(30,12) NOT NULL,
  "entryPrice" DECIMAL(24,8) NOT NULL,
  "markPrice" DECIMAL(24,8) NOT NULL,
  "unrealizedPnl" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "strategy_positions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "strategy_trade_results" (
  "id" UUID NOT NULL,
  "strategyId" UUID NOT NULL,
  "symbol" TEXT NOT NULL,
  "pnl" DECIMAL(24,8) NOT NULL,
  "returnPct" DOUBLE PRECISION NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strategy_trade_results_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "portfolio_risk_events" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "strategyId" UUID,
  "pipelineRunId" UUID,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "requestedNotional" DECIMAL(24,8) NOT NULL,
  "approvedNotional" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "approved" BOOLEAN NOT NULL,
  "reason" TEXT,
  "totalExposurePct" DOUBLE PRECISION NOT NULL,
  "strategyExposurePct" DOUBLE PRECISION NOT NULL,
  "correlatedStrategies" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_risk_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "portfolio_rebalances" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "equity" DECIMAL(24,8) NOT NULL,
  "reason" TEXT NOT NULL,
  "allocations" JSONB NOT NULL,
  "disabledKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_rebalances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_strategies_userId_key_key" ON "portfolio_strategies"("userId", "key");
CREATE INDEX "portfolio_strategies_userId_status_idx" ON "portfolio_strategies"("userId", "status");
CREATE UNIQUE INDEX "strategy_allocations_strategyId_key" ON "strategy_allocations"("strategyId");
CREATE UNIQUE INDEX "strategy_performance_strategyId_key" ON "strategy_performance"("strategyId");
CREATE UNIQUE INDEX "strategy_positions_strategyId_symbol_key" ON "strategy_positions"("strategyId", "symbol");
CREATE INDEX "strategy_positions_symbol_side_idx" ON "strategy_positions"("symbol", "side");
CREATE INDEX "strategy_trade_results_strategyId_closedAt_idx" ON "strategy_trade_results"("strategyId", "closedAt");
CREATE INDEX "portfolio_risk_events_userId_createdAt_idx" ON "portfolio_risk_events"("userId", "createdAt");
CREATE INDEX "portfolio_risk_events_pipelineRunId_idx" ON "portfolio_risk_events"("pipelineRunId");
CREATE INDEX "portfolio_rebalances_userId_createdAt_idx" ON "portfolio_rebalances"("userId", "createdAt");
CREATE INDEX "paper_positions_strategyId_idx" ON "paper_positions"("strategyId");

ALTER TABLE "portfolio_strategies" ADD CONSTRAINT "portfolio_strategies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "strategy_allocations" ADD CONSTRAINT "strategy_allocations_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "strategy_performance" ADD CONSTRAINT "strategy_performance_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "strategy_positions" ADD CONSTRAINT "strategy_positions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "strategy_trade_results" ADD CONSTRAINT "strategy_trade_results_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_risk_events" ADD CONSTRAINT "portfolio_risk_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_risk_events" ADD CONSTRAINT "portfolio_risk_events_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_rebalances" ADD CONSTRAINT "portfolio_rebalances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
