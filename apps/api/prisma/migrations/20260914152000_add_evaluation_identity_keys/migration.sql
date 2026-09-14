ALTER TABLE "performance_records" ADD COLUMN "evaluationKey" TEXT;

UPDATE "performance_records" AS pr
SET "evaluationKey" = md5(pr."runId"::text)
WHERE pr."evaluationKey" IS NULL;

CREATE UNIQUE INDEX "performance_records_evaluationKey_horizon_key" ON "performance_records"("evaluationKey", "horizon");
