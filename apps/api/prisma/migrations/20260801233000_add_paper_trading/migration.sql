CREATE TABLE "paper_accounts" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "balance" DECIMAL(24,8) NOT NULL,
  "equity" DECIMAL(24,8) NOT NULL, "marginUsed" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "peakEquity" DECIMAL(24,8) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "paper_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "paper_accounts_userId_key" ON "paper_accounts"("userId");
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "paper_positions" (
  "id" UUID NOT NULL, "accountId" UUID NOT NULL, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL,
  "size" DECIMAL(30,12) NOT NULL, "entryPrice" DECIMAL(24,8) NOT NULL, "markPrice" DECIMAL(24,8) NOT NULL,
  "leverage" INTEGER NOT NULL, "unrealizedPnL" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "realizedPnL" DECIMAL(24,8) NOT NULL DEFAULT 0, "entryFee" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "paper_positions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "paper_positions_accountId_symbol_key" ON "paper_positions"("accountId", "symbol");
CREATE INDEX "paper_positions_accountId_updatedAt_idx" ON "paper_positions"("accountId", "updatedAt");
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "simulated_orders" (
  "id" UUID NOT NULL, "accountId" UUID NOT NULL, "pipelineRunId" UUID, "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT 'MARKET', "quantity" DECIMAL(30,12) NOT NULL,
  "referencePrice" DECIMAL(24,8) NOT NULL, "executedPrice" DECIMAL(24,8) NOT NULL,
  "slippagePct" DECIMAL(12,10) NOT NULL, "fee" DECIMAL(24,8) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'FILLED', "purpose" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "simulated_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "simulated_orders_accountId_createdAt_idx" ON "simulated_orders"("accountId", "createdAt");
CREATE INDEX "simulated_orders_pipelineRunId_idx" ON "simulated_orders"("pipelineRunId");
ALTER TABLE "simulated_orders" ADD CONSTRAINT "simulated_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "paper_trades" (
  "id" UUID NOT NULL, "accountId" UUID NOT NULL, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL,
  "entryPrice" DECIMAL(24,8) NOT NULL, "exitPrice" DECIMAL(24,8) NOT NULL, "size" DECIMAL(30,12) NOT NULL,
  "pnl" DECIMAL(24,8) NOT NULL, "fee" DECIMAL(24,8) NOT NULL, "returnPct" DECIMAL(18,8) NOT NULL,
  "closeReason" TEXT NOT NULL, "durationMs" BIGINT NOT NULL, "openedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "paper_trades_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "paper_trades_accountId_closedAt_idx" ON "paper_trades"("accountId", "closedAt");
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "paper_signals" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "pipelineRunId" UUID, "symbol" TEXT NOT NULL,
  "decision" TEXT NOT NULL, "confidence" DOUBLE PRECISION NOT NULL, "mode" TEXT NOT NULL,
  "referencePrice" DECIMAL(24,8) NOT NULL, "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "paper_signals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "paper_signals_pipelineRunId_key" ON "paper_signals"("pipelineRunId");
CREATE INDEX "paper_signals_userId_createdAt_idx" ON "paper_signals"("userId", "createdAt");
ALTER TABLE "paper_signals" ADD CONSTRAINT "paper_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
