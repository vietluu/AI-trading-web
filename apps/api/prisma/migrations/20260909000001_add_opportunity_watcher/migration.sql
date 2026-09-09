-- CreateEnum
CREATE TYPE "OpportunityState" AS ENUM (
  'OBSERVING',
  'WATCHING',
  'PROBE_READY',
  'PROBE_OPEN',
  'CONFIRMED',
  'POSITION_OPEN',
  'INVALIDATED',
  'EXPIRED',
  'TOO_LATE'
);

-- CreateTable
CREATE TABLE "anticipatory_market_snapshots" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "calculationVersion" INTEGER NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "anticipatory_market_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "setup" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "thesisVersion" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "state" "OpportunityState" NOT NULL DEFAULT 'OBSERVING',
  "invalidationPrice" DECIMAL(24,8),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastObservedCutoff" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_transitions" (
  "id" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "fromState" "OpportunityState" NOT NULL,
  "toState" "OpportunityState" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "opportunity_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anticipatory_market_snapshots_provider_symbol_timeframe_sourceDataCutoff_key"
  ON "anticipatory_market_snapshots"("provider", "symbol", "timeframe", "sourceDataCutoff");

-- CreateIndex
CREATE INDEX "anticipatory_market_snapshots_symbol_timeframe_sourceDataCutoff_idx"
  ON "anticipatory_market_snapshots"("symbol", "timeframe", "sourceDataCutoff");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_idempotencyKey_key" ON "opportunities"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_userId_provider_symbol_timeframe_setup_thesisVersion_key"
  ON "opportunities"("userId", "provider", "symbol", "timeframe", "setup", "thesisVersion");

-- CreateIndex
CREATE INDEX "opportunities_userId_state_expiresAt_idx"
  ON "opportunities"("userId", "state", "expiresAt");

-- CreateIndex
CREATE INDEX "opportunities_provider_symbol_timeframe_setup_state_idx"
  ON "opportunities"("provider", "symbol", "timeframe", "setup", "state");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_transitions_idempotencyKey_key"
  ON "opportunity_transitions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_transitions_opportunityId_sourceDataCutoff_key"
  ON "opportunity_transitions"("opportunityId", "sourceDataCutoff");

-- CreateIndex
CREATE INDEX "opportunity_transitions_opportunityId_createdAt_idx"
  ON "opportunity_transitions"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "opportunity_transitions_snapshotId_idx"
  ON "opportunity_transitions"("snapshotId");

-- AddForeignKey
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions"
  ADD CONSTRAINT "opportunity_transitions_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions"
  ADD CONSTRAINT "opportunity_transitions_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "anticipatory_market_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
