ALTER TABLE "paper_signals"
  ADD COLUMN "marketRegime" TEXT,
  ADD COLUMN "returnPct" DOUBLE PRECISION;

ALTER TABLE "pipeline_runs"
  ADD COLUMN "marketRegime" TEXT,
  ADD COLUMN "configurationVersion" INTEGER,
  ADD COLUMN "learningStage" TEXT,
  ADD COLUMN "timeframe" TEXT;

ALTER TABLE "performance_records" ADD COLUMN "marketRegime" TEXT;

CREATE INDEX "pipeline_runs_userId_configurationVersion_learningStage_timeframe_createdAt_idx"
ON "pipeline_runs"("userId", "configurationVersion", "learningStage", "timeframe", "createdAt");
CREATE INDEX "performance_records_userId_horizon_marketRegime_evaluatedAt_idx"
ON "performance_records"("userId", "horizon", "marketRegime", "evaluatedAt");

ALTER TABLE "self_learning_configurations"
  ADD COLUMN "canaryEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canaryVersion" INTEGER,
  ADD COLUMN "canaryWeightsJson" JSONB,
  ADD COLUMN "canaryThreshold" DOUBLE PRECISION,
  ADD COLUMN "canaryStartedAt" TIMESTAMP(3),
  ADD COLUMN "previousWeightsJson" JSONB,
  ADD COLUMN "previousThreshold" DOUBLE PRECISION,
  ADD COLUMN "previousVersion" INTEGER;

CREATE TABLE "self_learning_experiments" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "baseVersion" INTEGER NOT NULL,
  "candidateWeightsJson" JSONB NOT NULL,
  "candidateThreshold" DOUBLE PRECISION NOT NULL,
  "trainStartedAt" TIMESTAMP(3) NOT NULL,
  "trainEndedAt" TIMESTAMP(3) NOT NULL,
  "validationStartedAt" TIMESTAMP(3) NOT NULL,
  "validationEndedAt" TIMESTAMP(3) NOT NULL,
  "trainMetricsJson" JSONB NOT NULL,
  "validationMetricsJson" JSONB NOT NULL,
  "reproducibleHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "self_learning_experiments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "self_learning_experiment_events" (
  "id" UUID NOT NULL,
  "experimentId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "self_learning_experiment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "self_learning_experiments_userId_version_key"
ON "self_learning_experiments"("userId", "version");
CREATE INDEX "self_learning_experiments_userId_createdAt_idx"
ON "self_learning_experiments"("userId", "createdAt");
CREATE INDEX "self_learning_experiments_reproducibleHash_idx"
ON "self_learning_experiments"("reproducibleHash");
CREATE INDEX "self_learning_experiment_events_experimentId_createdAt_idx"
ON "self_learning_experiment_events"("experimentId", "createdAt");

ALTER TABLE "self_learning_experiments" ADD CONSTRAINT "self_learning_experiments_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "self_learning_experiment_events" ADD CONSTRAINT "self_learning_experiment_events_experimentId_fkey"
FOREIGN KEY ("experimentId") REFERENCES "self_learning_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit rows are append-only. Cascading deletion from their owning aggregate is
-- still permitted for account lifecycle and retention workflows.
CREATE FUNCTION "protect_self_learning_audit"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'self-learning audit records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "self_learning_experiments_immutable"
BEFORE UPDATE OR DELETE ON "self_learning_experiments"
FOR EACH ROW EXECUTE FUNCTION "protect_self_learning_audit"();

CREATE TRIGGER "self_learning_experiment_events_immutable"
BEFORE UPDATE OR DELETE ON "self_learning_experiment_events"
FOR EACH ROW EXECUTE FUNCTION "protect_self_learning_audit"();
