-- AddColumn
ALTER TABLE "self_learning_configurations" ADD COLUMN "candidateShadowTrades" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "self_learning_configurations" ADD COLUMN "eligibleVersion" INTEGER;
ALTER TABLE "self_learning_configurations" ADD COLUMN "eligibleWeightsJson" JSONB;
ALTER TABLE "self_learning_configurations" ADD COLUMN "eligibleThreshold" DOUBLE PRECISION;
ALTER TABLE "self_learning_configurations" ADD COLUMN "eligibleMetricsJson" JSONB;
ALTER TABLE "self_learning_configurations" ADD COLUMN "eligibleConfigurationHash" TEXT;
ALTER TABLE "self_learning_configurations" ADD COLUMN "eligibleAt" TIMESTAMP(3);
ALTER TABLE "self_learning_configurations" ADD COLUMN "approvedVersion" INTEGER;
ALTER TABLE "self_learning_configurations" ADD COLUMN "approvedConfigurationHash" TEXT;
ALTER TABLE "self_learning_configurations" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- AddColumn
ALTER TABLE "performance_records" ADD COLUMN "provenanceEligible" BOOLEAN NOT NULL DEFAULT false;
