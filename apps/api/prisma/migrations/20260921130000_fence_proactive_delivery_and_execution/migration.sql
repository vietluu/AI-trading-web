ALTER TABLE "pipeline_runs"
  ADD COLUMN "proactiveDeliveryToken" UUID,
  ADD COLUMN "proactiveExecutionClaimedAt" TIMESTAMP(3);
