-- A crashed scheduler may leave a proactive run in DELIVERING. Its lease makes
-- that state reclaimable without taking work from a still-active scheduler.
ALTER TABLE "pipeline_runs" ADD COLUMN "proactiveDeliveryLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "pipeline_runs_proactiveDeliveryLeaseExpiresAt_idx"
ON "pipeline_runs"("proactiveDeliveryLeaseExpiresAt");
