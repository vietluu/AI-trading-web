CREATE TABLE "trade_ledger_backfill_checkpoints" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "symbolKey" TEXT NOT NULL,
    "cursorBefore" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "processedPages" INTEGER NOT NULL DEFAULT 0,
    "processedFills" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_ledger_backfill_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_ledger_backfill_checkpoints_connectionId_symbolKey_key"
ON "trade_ledger_backfill_checkpoints"("connectionId", "symbolKey");

CREATE INDEX "trade_ledger_backfill_checkpoints_userId_status_idx"
ON "trade_ledger_backfill_checkpoints"("userId", "status");

ALTER TABLE "trade_ledger_backfill_checkpoints"
ADD CONSTRAINT "trade_ledger_backfill_checkpoints_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_ledger_backfill_checkpoints"
ADD CONSTRAINT "trade_ledger_backfill_checkpoints_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "exchange_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
