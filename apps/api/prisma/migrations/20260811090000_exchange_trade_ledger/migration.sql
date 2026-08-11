ALTER TABLE "knowledge_archives" ADD COLUMN "userId" UUID;

CREATE TABLE "exchange_fills" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "strategyId" UUID,
    "liveOrderId" UUID,
    "provider" "ExchangeProvider" NOT NULL,
    "environment" "ExchangeEnvironment" NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchangeTradeId" TEXT NOT NULL,
    "exchangeOrderId" TEXT NOT NULL,
    "clientOrderId" TEXT,
    "side" TEXT NOT NULL,
    "positionSide" TEXT,
    "price" DECIMAL(24,8) NOT NULL,
    "quantity" DECIMAL(30,12) NOT NULL,
    "quoteQuantity" DECIMAL(24,8),
    "realizedPnl" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "fee" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "feeAsset" TEXT,
    "isMaker" BOOLEAN,
    "isClosing" BOOLEAN NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "exchange_fills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "closed_trades" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "strategyId" UUID,
    "provider" "ExchangeProvider" NOT NULL,
    "environment" "ExchangeEnvironment" NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchangeOrderId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "positionSide" TEXT,
    "quantity" DECIMAL(30,12) NOT NULL,
    "entryPrice" DECIMAL(24,8),
    "exitPrice" DECIMAL(24,8) NOT NULL,
    "grossPnl" DECIMAL(24,8) NOT NULL,
    "fee" DECIMAL(24,8) NOT NULL,
    "netPnl" DECIMAL(24,8) NOT NULL,
    "returnPct" DOUBLE PRECISION,
    "closeReason" TEXT NOT NULL,
    "sourceDataComplete" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "closed_trades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_fills_connectionId_symbol_exchangeTradeId_key" ON "exchange_fills"("connectionId", "symbol", "exchangeTradeId");
CREATE INDEX "exchange_fills_userId_executedAt_idx" ON "exchange_fills"("userId", "executedAt");
CREATE INDEX "exchange_fills_strategyId_executedAt_idx" ON "exchange_fills"("strategyId", "executedAt");
CREATE INDEX "exchange_fills_connectionId_exchangeOrderId_idx" ON "exchange_fills"("connectionId", "exchangeOrderId");
CREATE UNIQUE INDEX "closed_trades_connectionId_exchangeOrderId_key" ON "closed_trades"("connectionId", "exchangeOrderId");
CREATE INDEX "closed_trades_userId_closedAt_idx" ON "closed_trades"("userId", "closedAt");
CREATE INDEX "closed_trades_strategyId_closedAt_idx" ON "closed_trades"("strategyId", "closedAt");
CREATE INDEX "closed_trades_symbol_closedAt_idx" ON "closed_trades"("symbol", "closedAt");
CREATE INDEX "knowledge_archives_userId_createdAt_idx" ON "knowledge_archives"("userId", "createdAt");
CREATE UNIQUE INDEX "knowledge_archives_userId_reproducibleHash_key" ON "knowledge_archives"("userId", "reproducibleHash");

ALTER TABLE "knowledge_archives" ADD CONSTRAINT "knowledge_archives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exchange_fills" ADD CONSTRAINT "exchange_fills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exchange_fills" ADD CONSTRAINT "exchange_fills_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "exchange_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exchange_fills" ADD CONSTRAINT "exchange_fills_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exchange_fills" ADD CONSTRAINT "exchange_fills_liveOrderId_fkey" FOREIGN KEY ("liveOrderId") REFERENCES "live_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "closed_trades" ADD CONSTRAINT "closed_trades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "closed_trades" ADD CONSTRAINT "closed_trades_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "exchange_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "closed_trades" ADD CONSTRAINT "closed_trades_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "portfolio_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
