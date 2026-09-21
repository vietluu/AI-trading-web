ALTER TABLE "PipelineRun"
  ADD COLUMN "proactiveDeliveryToken" UUID,
  ADD COLUMN "proactiveExecutionClaimedAt" TIMESTAMP(3);
