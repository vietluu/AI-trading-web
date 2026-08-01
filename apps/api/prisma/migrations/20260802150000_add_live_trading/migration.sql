CREATE TABLE "live_orders" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "riskAssessmentId" UUID, "exchangeOrderId" TEXT, "clientOrderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL, "environment" TEXT NOT NULL, "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT 'MARKET',
  "quantity" DECIMAL(30,12) NOT NULL, "leverage" INTEGER NOT NULL,
  "averagePrice" DECIMAL(24,8), "status" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'OPEN', "reduceOnly" BOOLEAN NOT NULL DEFAULT false,
  "stopLoss" DECIMAL(24,8), "takeProfit" DECIMAL(24,8),
  "errorCode" TEXT, "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "live_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "live_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "live_orders_connectionId_clientOrderId_key" ON "live_orders"("connectionId", "clientOrderId");
CREATE UNIQUE INDEX "live_orders_riskAssessmentId_key" ON "live_orders"("riskAssessmentId");
CREATE INDEX "live_orders_userId_createdAt_idx" ON "live_orders"("userId", "createdAt");
CREATE INDEX "live_orders_connectionId_status_idx" ON "live_orders"("connectionId", "status");
CREATE INDEX "live_orders_riskAssessmentId_idx" ON "live_orders"("riskAssessmentId");

CREATE TABLE "live_positions" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "provider" TEXT NOT NULL, "environment" TEXT NOT NULL, "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL, "quantity" DECIMAL(30,12) NOT NULL,
  "entryPrice" DECIMAL(24,8) NOT NULL, "markPrice" DECIMAL(24,8),
  "liquidationPrice" DECIMAL(24,8), "leverage" INTEGER,
  "unrealizedPnl" DECIMAL(24,8) NOT NULL DEFAULT 0, "notional" DECIMAL(24,8),
  "syncedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "live_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "live_positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "live_positions_connectionId_symbol_side_key" ON "live_positions"("connectionId", "symbol", "side");
CREATE INDEX "live_positions_userId_syncedAt_idx" ON "live_positions"("userId", "syncedAt");

CREATE TABLE "live_account_snapshots" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "provider" TEXT NOT NULL, "environment" TEXT NOT NULL,
  "totalEquity" DECIMAL(24,8) NOT NULL, "availableBalance" DECIMAL(24,8) NOT NULL,
  "unrealizedPnl" DECIMAL(24,8) NOT NULL, "marginBalance" DECIMAL(24,8) NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "live_account_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "live_account_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "live_account_snapshots_userId_connectionId_syncedAt_idx" ON "live_account_snapshots"("userId", "connectionId", "syncedAt");
