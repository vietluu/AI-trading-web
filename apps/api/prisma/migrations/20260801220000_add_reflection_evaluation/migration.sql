CREATE TYPE "EvaluationHorizon" AS ENUM ('SHORT', 'MID', 'LONG');
CREATE TYPE "PerformanceOutcome" AS ENUM ('CORRECT', 'WRONG', 'NEUTRAL');
CREATE TYPE "ReflectionCategory" AS ENUM ('RISK', 'BIAS', 'DATA', 'TIMING');
CREATE TYPE "ReflectionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ImprovementProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "performance_records" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "runId" UUID NOT NULL,
  "symbol" TEXT NOT NULL, "horizon" "EvaluationHorizon" NOT NULL,
  "decision" TEXT NOT NULL, "confidence" DOUBLE PRECISION NOT NULL,
  "priceAtDecision" DECIMAL(24,8) NOT NULL, "priceAfter" DECIMAL(24,8) NOT NULL,
  "outcome" "PerformanceOutcome" NOT NULL, "returnPct" DOUBLE PRECISION NOT NULL,
  "highVolatility" BOOLEAN NOT NULL DEFAULT false, "majorNews" BOOLEAN NOT NULL DEFAULT false,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_records_runId_horizon_key" ON "performance_records"("runId", "horizon");
CREATE INDEX "performance_records_userId_evaluatedAt_idx" ON "performance_records"("userId", "evaluatedAt");
CREATE INDEX "performance_records_symbol_horizon_evaluatedAt_idx" ON "performance_records"("symbol", "horizon", "evaluatedAt");

CREATE TABLE "reflection_insights" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "summary" TEXT NOT NULL,
  "category" "ReflectionCategory" NOT NULL, "severity" "ReflectionSeverity" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reflection_insights_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reflection_insights_userId_createdAt_idx" ON "reflection_insights"("userId", "createdAt");

CREATE TABLE "improvement_proposals" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "description" TEXT NOT NULL,
  "proposedChange" TEXT NOT NULL, "status" "ImprovementProposalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "improvement_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "improvement_proposals_userId_createdAt_idx" ON "improvement_proposals"("userId", "createdAt");

ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reflection_insights" ADD CONSTRAINT "reflection_insights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "improvement_proposals" ADD CONSTRAINT "improvement_proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
