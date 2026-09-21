-- A proactive run is duplicate only after its queue handoff succeeds.
ALTER TABLE "pipeline_runs" ADD COLUMN "proactiveDeliveryState" TEXT;

CREATE INDEX "pipeline_runs_proactiveDeliveryState_idx"
ON "pipeline_runs"("proactiveDeliveryState");
