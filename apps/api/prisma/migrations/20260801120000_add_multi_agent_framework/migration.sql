-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('MARKET_ANALYST', 'TECHNICAL_ANALYST', 'NEWS_ANALYST', 'SOCIAL_ANALYST', 'MACRO_ANALYST', 'ON_CHAIN_ANALYST', 'RISK_REVIEWER', 'DECISION_SYNTHESIZER', 'JUDGE', 'MEMORY_AGENT', 'PERFORMANCE', 'REFLECTION', 'SYSTEM_DIAGNOSTIC');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('CREATED', 'QUEUED', 'PREPARING_CONTEXT', 'READY', 'RUNNING', 'WAITING_FOR_TOOL', 'PROCESSING_TOOL_RESULT', 'VALIDATING_OUTPUT', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCEL_REQUESTED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgentInvocationSource" AS ENUM ('USER_MANUAL', 'INTERNAL_SERVICE', 'SYSTEM_TEST', 'REPLAY', 'FUTURE_SCHEDULED', 'FUTURE_EVENT_DRIVEN');

-- CreateTable
CREATE TABLE "agent_definitions" (
    "id" UUID NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ToolStatus" NOT NULL DEFAULT 'ACTIVE',
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "definitionHash" TEXT NOT NULL,
    "schemaHash" TEXT NOT NULL,
    "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "agentType" "AgentType" NOT NULL,
    "agentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'CREATED',
    "invocationSource" "AgentInvocationSource" NOT NULL DEFAULT 'USER_MANUAL',
    "inputHash" TEXT NOT NULL,
    "sanitizedInput" JSONB,
    "output" JSONB,
    "outputSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "contextSnapshotId" UUID,
    "provider" TEXT,
    "model" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(18,6),
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "toolRoundCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "safeFailureMessage" TEXT,
    "traceId" TEXT,
    "correlationId" TEXT,
    "parentRunId" UUID,
    "replayOfRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_transitions" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "fromState" "AgentRunStatus" NOT NULL,
    "toState" "AgentRunStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_context_snapshots" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "symbol" TEXT,
    "provider" TEXT,
    "timeframe" TEXT,
    "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "builderVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "contextHash" TEXT NOT NULL,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "serializedContext" JSONB NOT NULL,
    "marketRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newsRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "macroRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentimentRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memoryRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_outputs" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "validatedOutput" JSONB NOT NULL,
    "rawOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_quota_usages" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "windowKey" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_quota_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_definitions_agentType_version_key" ON "agent_definitions"("agentType", "version");
CREATE INDEX "agent_definitions_agentType_status_idx" ON "agent_definitions"("agentType", "status");

-- CreateIndex
CREATE INDEX "agent_runs_userId_createdAt_idx" ON "agent_runs"("userId", "createdAt");
CREATE INDEX "agent_runs_agentType_status_idx" ON "agent_runs"("agentType", "status");
CREATE INDEX "agent_runs_correlationId_idx" ON "agent_runs"("correlationId");
CREATE INDEX "agent_runs_parentRunId_idx" ON "agent_runs"("parentRunId");
CREATE INDEX "agent_runs_replayOfRunId_idx" ON "agent_runs"("replayOfRunId");
CREATE INDEX "agent_runs_traceId_idx" ON "agent_runs"("traceId");

-- CreateIndex
CREATE INDEX "agent_run_transitions_runId_createdAt_idx" ON "agent_run_transitions"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_context_snapshots_contextHash_idx" ON "agent_context_snapshots"("contextHash");
CREATE INDEX "agent_context_snapshots_userId_createdAt_idx" ON "agent_context_snapshots"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_outputs_runId_key" ON "agent_run_outputs"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_quota_usages_userId_windowKey_key" ON "agent_quota_usages"("userId", "windowKey");
CREATE INDEX "agent_quota_usages_userId_windowKey_idx" ON "agent_quota_usages"("userId", "windowKey");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_contextSnapshotId_fkey" FOREIGN KEY ("contextSnapshotId") REFERENCES "agent_context_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_transitions" ADD CONSTRAINT "agent_run_transitions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_outputs" ADD CONSTRAINT "agent_run_outputs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_quota_usages" ADD CONSTRAINT "agent_quota_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
