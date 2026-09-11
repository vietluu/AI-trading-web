-- AlterTable opportunity_transitions
ALTER TABLE "opportunity_transitions"
  ADD COLUMN "parentTransitionId" UUID,
  ADD COLUMN "thesisId" UUID,
  ADD COLUMN "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "configurationHash" TEXT;

-- CreateTable trade_theses
CREATE TABLE "trade_theses" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "parentThesisId" UUID,
  "snapshotId" UUID,
  "opportunityId" UUID,
  "symbol" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "thesisVersion" INTEGER NOT NULL DEFAULT 1,
  "decisionSource" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "regime" TEXT NOT NULL,
  "setup" TEXT NOT NULL,
  "transitionProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "entryZone" JSONB,
  "trigger" JSONB,
  "invalidation" JSONB,
  "stopLoss" DECIMAL(24,8),
  "targets" JSONB,
  "expectedNetR" DECIMAL(24,8),
  "maximumChaseDistanceAtr" DECIMAL(24,8),
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidenceFor" JSONB,
  "evidenceAgainst" JSONB,
  "missingEvidence" JSONB,
  "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  "modelProvider" TEXT,
  "model" TEXT,
  "promptVersion" INTEGER,
  "configurationHash" TEXT NOT NULL,
  "thesisJson" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trade_theses_pkey" PRIMARY KEY ("id")
);

-- CreateTable thesis_reviews
CREATE TABLE "thesis_reviews" (
  "id" UUID NOT NULL,
  "thesisId" UUID NOT NULL,
  "parentReviewId" UUID,
  "action" TEXT NOT NULL,
  "sizeFactor" DOUBLE PRECISION,
  "reasonCodes" JSONB NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "rationale" TEXT NOT NULL,
  "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
  "modelProvider" TEXT,
  "model" TEXT,
  "promptVersion" INTEGER,
  "configurationHash" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  "reviewJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "thesis_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable execution_plan_versions
CREATE TABLE "execution_plan_versions" (
  "id" UUID NOT NULL,
  "thesisId" UUID NOT NULL,
  "parentPlanId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL,
  "planJson" JSONB NOT NULL,
  "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
  "modelProvider" TEXT,
  "model" TEXT,
  "promptVersion" INTEGER,
  "configurationHash" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "execution_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable trade_lifecycle_outcomes
CREATE TABLE "trade_lifecycle_outcomes" (
  "id" UUID NOT NULL,
  "thesisId" UUID NOT NULL,
  "symbol" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "setup" TEXT,
  "regime" TEXT,
  "status" TEXT NOT NULL,
  "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "totalEnteredQuantity" DECIMAL(30,12) NOT NULL,
  "totalExitedQuantity" DECIMAL(30,12) NOT NULL,
  "averageEntryPrice" DECIMAL(24,8) NOT NULL,
  "averageExitPrice" DECIMAL(24,8),
  "realizedGrossPnl" DECIMAL(24,8) NOT NULL,
  "signedFees" DECIMAL(24,8) NOT NULL,
  "signedFunding" DECIMAL(24,8) NOT NULL,
  "realizedNetPnl" DECIMAL(24,8) NOT NULL,
  "initialRisk" DECIMAL(24,8),
  "netR" DECIMAL(24,8),
  "mfe" DECIMAL(24,8),
  "mae" DECIMAL(24,8),
  "finalStopLoss" DECIMAL(24,8),
  "exitReason" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  "configurationHash" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "trade_lifecycle_outcomes_pkey" PRIMARY KEY ("id")
);

-- Indexes for trade_theses
CREATE UNIQUE INDEX "trade_theses_symbol_provider_timeframe_thesisVersion_sourceDataCutoff_key"
  ON "trade_theses"("symbol", "provider", "timeframe", "thesisVersion", "sourceDataCutoff");

CREATE INDEX "trade_theses_symbol_timeframe_sourceDataCutoff_idx"
  ON "trade_theses"("symbol", "timeframe", "sourceDataCutoff");

CREATE INDEX "trade_theses_userId_state_expiresAt_idx"
  ON "trade_theses"("userId", "state", "expiresAt");

CREATE INDEX "trade_theses_configurationHash_idx"
  ON "trade_theses"("configurationHash");

-- Indexes for thesis_reviews
CREATE INDEX "thesis_reviews_thesisId_createdAt_idx"
  ON "thesis_reviews"("thesisId", "createdAt");

CREATE INDEX "thesis_reviews_configurationHash_idx"
  ON "thesis_reviews"("configurationHash");

-- Indexes for execution_plan_versions
CREATE UNIQUE INDEX "execution_plan_versions_thesisId_version_key"
  ON "execution_plan_versions"("thesisId", "version");

CREATE INDEX "execution_plan_versions_thesisId_createdAt_idx"
  ON "execution_plan_versions"("thesisId", "createdAt");

CREATE INDEX "execution_plan_versions_configurationHash_idx"
  ON "execution_plan_versions"("configurationHash");

-- Indexes for trade_lifecycle_outcomes
CREATE UNIQUE INDEX "trade_lifecycle_outcomes_thesisId_key"
  ON "trade_lifecycle_outcomes"("thesisId");

CREATE INDEX "trade_lifecycle_outcomes_symbol_timeframe_sourceDataCutoff_idx"
  ON "trade_lifecycle_outcomes"("symbol", "timeframe", "sourceDataCutoff");

CREATE INDEX "trade_lifecycle_outcomes_configurationHash_idx"
  ON "trade_lifecycle_outcomes"("configurationHash");

CREATE INDEX "trade_lifecycle_outcomes_status_closedAt_idx"
  ON "trade_lifecycle_outcomes"("status", "closedAt");

-- Indexes for opportunity_transitions
CREATE INDEX "opportunity_transitions_thesisId_idx"
  ON "opportunity_transitions"("thesisId");

-- ForeignKeys
ALTER TABLE "opportunity_transitions"
  ADD CONSTRAINT "opportunity_transitions_parentTransitionId_fkey"
  FOREIGN KEY ("parentTransitionId") REFERENCES "opportunity_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "opportunity_transitions"
  ADD CONSTRAINT "opportunity_transitions_thesisId_fkey"
  FOREIGN KEY ("thesisId") REFERENCES "trade_theses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trade_theses"
  ADD CONSTRAINT "trade_theses_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_theses"
  ADD CONSTRAINT "trade_theses_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "anticipatory_market_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trade_theses"
  ADD CONSTRAINT "trade_theses_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trade_theses"
  ADD CONSTRAINT "trade_theses_parentThesisId_fkey"
  FOREIGN KEY ("parentThesisId") REFERENCES "trade_theses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "thesis_reviews"
  ADD CONSTRAINT "thesis_reviews_thesisId_fkey"
  FOREIGN KEY ("thesisId") REFERENCES "trade_theses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "thesis_reviews"
  ADD CONSTRAINT "thesis_reviews_parentReviewId_fkey"
  FOREIGN KEY ("parentReviewId") REFERENCES "thesis_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "execution_plan_versions"
  ADD CONSTRAINT "execution_plan_versions_thesisId_fkey"
  FOREIGN KEY ("thesisId") REFERENCES "trade_theses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "execution_plan_versions"
  ADD CONSTRAINT "execution_plan_versions_parentPlanId_fkey"
  FOREIGN KEY ("parentPlanId") REFERENCES "execution_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trade_lifecycle_outcomes"
  ADD CONSTRAINT "trade_lifecycle_outcomes_thesisId_fkey"
  FOREIGN KEY ("thesisId") REFERENCES "trade_theses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
