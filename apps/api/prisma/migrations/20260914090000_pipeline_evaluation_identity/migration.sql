-- Add durable identity only for evaluations created after this migration.
-- Legacy rows intentionally remain NULL rather than receiving fabricated provenance.
ALTER TABLE "pipeline_runs" ADD COLUMN "evaluationKey" TEXT;
ALTER TABLE "paper_signals" ADD COLUMN "evaluationKey" TEXT;

-- Dry-run diagnostics: report any populated duplicate groups before enforcing
-- sample uniqueness. Fresh migrations return no rows because no backfill occurs.
SELECT "evaluationKey", COUNT(*) AS "duplicateCount"
FROM "pipeline_runs"
WHERE "evaluationKey" IS NOT NULL
GROUP BY "evaluationKey"
HAVING COUNT(*) > 1;

SELECT "evaluationKey", COUNT(*) AS "duplicateCount"
FROM "paper_signals"
WHERE "evaluationKey" IS NOT NULL
GROUP BY "evaluationKey"
HAVING COUNT(*) > 1;

-- Pipeline runs remain independently executable. Only evidence samples are unique.
CREATE INDEX "pipeline_runs_evaluationKey_idx"
ON "pipeline_runs"("evaluationKey");

CREATE UNIQUE INDEX "paper_signals_evaluationKey_key"
ON "paper_signals"("evaluationKey")
WHERE "evaluationKey" IS NOT NULL;
