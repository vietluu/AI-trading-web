-- One proactive run may be claimed for each opportunity/snapshot identity.
-- This is intentionally separate from evaluationKey, whose semantics remain
-- evaluation-sample provenance rather than delivery idempotency.
ALTER TABLE "pipeline_runs" ADD COLUMN "proactiveThesisKey" TEXT;

CREATE UNIQUE INDEX "pipeline_runs_proactiveThesisKey_key"
ON "pipeline_runs"("proactiveThesisKey");
