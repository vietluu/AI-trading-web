-- Preserve staged entry intent and durable release restrictions through every execute API.
ALTER TABLE "live_orders" ADD COLUMN IF NOT EXISTS "stagedEntry" JSONB;
ALTER TABLE "risk_assessments" ADD COLUMN "executionAuthorization" JSONB;

-- Pre-migration proactive approvals lack validated thesis authorization and must be reassessed.
UPDATE "risk_assessments" AS assessment
SET "approved" = FALSE, "reason" = 'PROACTIVE_REASSESSMENT_REQUIRED'
FROM "pipeline_runs" AS run
WHERE assessment."pipelineRunId" = run."id" AND run."pipelineId" = 'proactive-thesis';
