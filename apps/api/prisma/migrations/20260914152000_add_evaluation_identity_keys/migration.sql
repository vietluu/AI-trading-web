ALTER TABLE "paper_signals" ADD COLUMN "evaluationKey" TEXT;
ALTER TABLE "pipeline_runs" ADD COLUMN "evaluationKey" TEXT;
ALTER TABLE "performance_records" ADD COLUMN "evaluationKey" TEXT;

UPDATE "pipeline_runs"
SET "evaluationKey" = md5("id"::text)
WHERE "evaluationKey" IS NULL;

UPDATE "paper_signals"
SET "evaluationKey" = md5("pipelineRunId"::text)
WHERE "pipelineRunId" IS NOT NULL
  AND "evaluationKey" IS NULL;

UPDATE "performance_records" AS pr
SET "evaluationKey" = md5(pr."runId"::text)
WHERE pr."evaluationKey" IS NULL;

CREATE INDEX "paper_signals_evaluationKey_idx" ON "paper_signals"("evaluationKey");
CREATE INDEX "pipeline_runs_evaluationKey_idx" ON "pipeline_runs"("evaluationKey");
CREATE UNIQUE INDEX "performance_records_evaluationKey_horizon_key" ON "performance_records"("evaluationKey", "horizon");
