-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DEPLOYED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'RESEARCH', 'STRATEGY', 'PORTFOLIO', 'RISK');

-- DropForeignKey
ALTER TABLE "pipeline_alerts" DROP CONSTRAINT "pipeline_alerts_runId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_userId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_schedules" DROP CONSTRAINT "pipeline_schedules_userId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_step_runs" DROP CONSTRAINT "pipeline_step_runs_runId_fkey";

-- AlterTable
ALTER TABLE "ai_configurations" ALTER COLUMN "preferredProvider" SET DEFAULT 'GEMINI',
ALTER COLUMN "preferredModel" SET DEFAULT 'gemini-3.1-flash-lite',
ALTER COLUMN "fallbackEnabled" SET DEFAULT false,
ALTER COLUMN "fallbackProviders" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "risk_assessments" ADD COLUMN     "connectionId" UUID;

-- CreateTable
CREATE TABLE "research_validation_runs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "symbol" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "lookbackCandles" INTEGER NOT NULL,
    "monteCarloSimulations" INTEGER NOT NULL DEFAULT 10000,
    "probabilityOfProfit" DOUBLE PRECISION NOT NULL,
    "probabilityOfRuin" DOUBLE PRECISION NOT NULL,
    "expectedDrawdown" DOUBLE PRECISION NOT NULL,
    "worstDrawdown" DOUBLE PRECISION NOT NULL,
    "walkForwardStable" BOOLEAN NOT NULL,
    "walkForwardAvgReturn" DOUBLE PRECISION NOT NULL,
    "bootstrapSharpe95" DOUBLE PRECISION[],
    "confidenceBrierScore" DOUBLE PRECISION NOT NULL,
    "regimeStabilityScore" DOUBLE PRECISION NOT NULL,
    "crossSymbolRank" INTEGER NOT NULL DEFAULT 1,
    "outOfSampleSharpe" DOUBLE PRECISION NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_suite_runs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "symbol" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "strategyCount" INTEGER NOT NULL DEFAULT 20,
    "topStrategyName" TEXT NOT NULL,
    "leaderboardJson" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_suite_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensitivity_heatmaps" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "symbol" TEXT NOT NULL,
    "parameterName" TEXT NOT NULL,
    "gridValues" JSONB NOT NULL,
    "metricsSurface" JSONB NOT NULL,
    "optimalValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensitivity_heatmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quant_hypotheses" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hypothesisText" TEXT NOT NULL,
    "statisticalProof" JSONB,
    "expectedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sharpeRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RESEARCHING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quant_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_strategies" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sharpeRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calmarRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDrawdown" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rulesJson" JSONB NOT NULL,
    "parametersJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovered_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factor_evaluations" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "factorName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "predictivePower" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contribution" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noiseScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "redundancyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factor_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_benchmark_records" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "strategyName" TEXT NOT NULL,
    "benchmarkTarget" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "comparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_benchmark_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_optimization_records" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "scope" TEXT NOT NULL,
    "optimizedWeights" JSONB NOT NULL,
    "expectedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sharpeRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "optimizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_optimization_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_optimization_records" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "thresholdName" TEXT NOT NULL,
    "optimizedValue" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION NOT NULL,
    "expectedImprovement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "optimizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threshold_optimization_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_learning_insights" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "insightType" TEXT NOT NULL,
    "tradeSymbol" TEXT,
    "summary" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_learning_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_regime_states" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recommendedConfig" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_regime_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quant_recommendations" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "title" TEXT NOT NULL,
    "moduleSource" TEXT NOT NULL,
    "problemStatement" TEXT NOT NULL,
    "evidenceText" TEXT NOT NULL,
    "historicalResult" JSONB NOT NULL,
    "expectedBenefit" TEXT NOT NULL,
    "estimatedRisk" TEXT NOT NULL,
    "priority" "RecommendationPriority" NOT NULL DEFAULT 'MEDIUM',
    "implementationCost" TEXT NOT NULL DEFAULT 'LOW',
    "rollbackPlan" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quant_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_experiments" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "experimentType" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "simulationResult" JSONB NOT NULL,
    "passedCriteria" BOOLEAN NOT NULL DEFAULT false,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quant_report_records" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "reportType" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quant_report_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_archives" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "reproducibleHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_validation_runs_userId_createdAt_idx" ON "research_validation_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "research_validation_runs_symbol_provider_idx" ON "research_validation_runs"("symbol", "provider");

-- CreateIndex
CREATE INDEX "benchmark_suite_runs_userId_createdAt_idx" ON "benchmark_suite_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "benchmark_suite_runs_symbol_provider_idx" ON "benchmark_suite_runs"("symbol", "provider");

-- CreateIndex
CREATE INDEX "sensitivity_heatmaps_userId_parameterName_idx" ON "sensitivity_heatmaps"("userId", "parameterName");

-- CreateIndex
CREATE INDEX "quant_hypotheses_userId_category_idx" ON "quant_hypotheses"("userId", "category");

-- CreateIndex
CREATE INDEX "discovered_strategies_userId_kind_idx" ON "discovered_strategies"("userId", "kind");

-- CreateIndex
CREATE INDEX "factor_evaluations_userId_category_idx" ON "factor_evaluations"("userId", "category");

-- CreateIndex
CREATE INDEX "auto_benchmark_records_userId_strategyName_idx" ON "auto_benchmark_records"("userId", "strategyName");

-- CreateIndex
CREATE INDEX "weight_optimization_records_userId_scope_idx" ON "weight_optimization_records"("userId", "scope");

-- CreateIndex
CREATE INDEX "threshold_optimization_records_userId_thresholdName_idx" ON "threshold_optimization_records"("userId", "thresholdName");

-- CreateIndex
CREATE INDEX "self_learning_insights_userId_insightType_idx" ON "self_learning_insights"("userId", "insightType");

-- CreateIndex
CREATE INDEX "market_regime_states_symbol_regime_idx" ON "market_regime_states"("symbol", "regime");

-- CreateIndex
CREATE INDEX "quant_recommendations_userId_status_idx" ON "quant_recommendations"("userId", "status");

-- CreateIndex
CREATE INDEX "simulation_experiments_userId_experimentType_idx" ON "simulation_experiments"("userId", "experimentType");

-- CreateIndex
CREATE INDEX "quant_report_records_userId_reportType_idx" ON "quant_report_records"("userId", "reportType");

-- CreateIndex
CREATE INDEX "knowledge_archives_category_idx" ON "knowledge_archives"("category");

-- CreateIndex
CREATE INDEX "risk_assessments_userId_connectionId_idx" ON "risk_assessments"("userId", "connectionId");

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "exchange_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_schedules" ADD CONSTRAINT "pipeline_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_step_runs" ADD CONSTRAINT "pipeline_step_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_alerts" ADD CONSTRAINT "pipeline_alerts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_validation_runs" ADD CONSTRAINT "research_validation_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_suite_runs" ADD CONSTRAINT "benchmark_suite_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitivity_heatmaps" ADD CONSTRAINT "sensitivity_heatmaps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "pipeline_schedules_userId_pipelineId_provider_mode_cron_interva" RENAME TO "pipeline_schedules_userId_pipelineId_provider_mode_cron_int_key";
