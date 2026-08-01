-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEPRECATED', 'EXPERIMENTAL', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "ai_tool_invocations" (
    "id" UUID NOT NULL,
    "invocationId" TEXT NOT NULL,
    "userId" UUID,
    "agentRunId" TEXT,
    "aiRequestId" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "toolName" TEXT NOT NULL,
    "toolVersion" INTEGER NOT NULL DEFAULT 1,
    "invocationSource" TEXT NOT NULL DEFAULT 'AI_PROVIDER',
    "inputHash" TEXT NOT NULL,
    "sanitizedInput" JSONB,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "resultSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "estimatedResultTokens" INTEGER NOT NULL DEFAULT 0,
    "traceId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_definitions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "sideEffect" TEXT NOT NULL,
    "status" "ToolStatus" NOT NULL DEFAULT 'ACTIVE',
    "schemaHash" TEXT NOT NULL,
    "deprecatedAt" TIMESTAMP(3),
    "replacementName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_quotas" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "windowKey" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "resultTokens" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_invocations_invocationId_key" ON "ai_tool_invocations"("invocationId");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_userId_createdAt_idx" ON "ai_tool_invocations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_toolName_status_idx" ON "ai_tool_invocations"("toolName", "status");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_invocationSource_createdAt_idx" ON "ai_tool_invocations"("invocationSource", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_definitions_name_key" ON "ai_tool_definitions"("name");

-- CreateIndex
CREATE INDEX "ai_tool_quotas_userId_windowKey_idx" ON "ai_tool_quotas"("userId", "windowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_quotas_userId_windowKey_key" ON "ai_tool_quotas"("userId", "windowKey");

-- AddForeignKey
ALTER TABLE "ai_tool_invocations" ADD CONSTRAINT "ai_tool_invocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_quotas" ADD CONSTRAINT "ai_tool_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
