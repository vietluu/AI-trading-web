CREATE TYPE "PipelineRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'SKIPPED');
CREATE TYPE "PipelineTrigger" AS ENUM ('SCHEDULE', 'MANUAL', 'REPLAY', 'EVENT');
CREATE TYPE "PipelineStepType" AS ENUM ('AGENT', 'FUSION', 'DECISION');
CREATE TYPE "PipelineStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'SKIPPED');
CREATE TYPE "PipelineScheduleMode" AS ENUM ('CRON', 'INTERVAL');

CREATE TABLE "pipeline_schedules" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "pipelineId" TEXT NOT NULL,
  "symbols" TEXT[] NOT NULL, "provider" "ExchangeProvider" NOT NULL,
  "mode" "PipelineScheduleMode" NOT NULL, "cron" TEXT, "intervalMs" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "maxRunsPerHour" INTEGER NOT NULL DEFAULT 60, "lastTriggeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pipeline_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "pipeline_schedules_userId_pipelineId_provider_mode_cron_intervalMs_key" ON "pipeline_schedules"("userId", "pipelineId", "provider", "mode", "cron", "intervalMs");
CREATE INDEX "pipeline_schedules_enabled_lastTriggeredAt_idx" ON "pipeline_schedules"("enabled", "lastTriggeredAt");

CREATE TABLE "pipeline_runs" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "pipelineId" TEXT NOT NULL, "pipelineVersion" INTEGER NOT NULL DEFAULT 1,
  "symbol" TEXT NOT NULL, "provider" "ExchangeProvider" NOT NULL, "status" "PipelineRunStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger" "PipelineTrigger" NOT NULL, "params" JSONB, "storedContext" JSONB, "result" JSONB,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "durationMs" INTEGER, "decision" TEXT,
  "confidence" DOUBLE PRECISION, "dataQuality" TEXT, "skippedReason" TEXT, "errorCode" TEXT, "safeErrorMessage" TEXT,
  "traceId" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "replayOfRunId" UUID, "scheduleId" UUID,
  "cancellationRequestedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "pipeline_runs_userId_createdAt_idx" ON "pipeline_runs"("userId", "createdAt");
CREATE INDEX "pipeline_runs_status_createdAt_idx" ON "pipeline_runs"("status", "createdAt");
CREATE INDEX "pipeline_runs_pipelineId_symbol_createdAt_idx" ON "pipeline_runs"("pipelineId", "symbol", "createdAt");
CREATE INDEX "pipeline_runs_correlationId_idx" ON "pipeline_runs"("correlationId");
CREATE INDEX "pipeline_runs_replayOfRunId_idx" ON "pipeline_runs"("replayOfRunId");

CREATE TABLE "pipeline_step_runs" (
  "id" UUID NOT NULL, "runId" UUID NOT NULL, "stepId" TEXT NOT NULL, "type" "PipelineStepType" NOT NULL,
  "status" "PipelineStepStatus" NOT NULL DEFAULT 'PENDING', "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER, "outputRef" JSONB, "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_step_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_step_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "pipeline_step_runs_runId_stepId_key" ON "pipeline_step_runs"("runId", "stepId");
CREATE INDEX "pipeline_step_runs_runId_createdAt_idx" ON "pipeline_step_runs"("runId", "createdAt");

CREATE TABLE "pipeline_alerts" (
  "id" UUID NOT NULL, "runId" UUID NOT NULL, "kind" TEXT NOT NULL, "channel" TEXT NOT NULL DEFAULT 'CONSOLE',
  "symbol" TEXT NOT NULL, "decision" TEXT, "confidence" DOUBLE PRECISION, "reasoningSummary" TEXT NOT NULL,
  "delivered" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_alerts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE
);
CREATE INDEX "pipeline_alerts_runId_createdAt_idx" ON "pipeline_alerts"("runId", "createdAt");
