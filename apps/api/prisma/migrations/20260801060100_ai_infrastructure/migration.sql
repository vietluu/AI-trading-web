-- CreateEnum
CREATE TYPE "AIMemoryType" AS ENUM ('CONVERSATION', 'DECISION', 'OBSERVATION', 'REFLECTION', 'MARKET_SNAPSHOT');

-- CreateEnum
CREATE TYPE "AIProviderType" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA');

-- CreateTable
CREATE TABLE "ai_histories" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" TEXT,
    "provider" "AIProviderType" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "response" TEXT NOT NULL,
    "responseJson" JSONB,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "finishReason" TEXT,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memories" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" TEXT,
    "type" "AIMemoryType" NOT NULL,
    "key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 50,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_configurations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "preferredProvider" "AIProviderType" NOT NULL DEFAULT 'OPENAI',
    "preferredModel" TEXT NOT NULL DEFAULT 'gpt-5-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "dailyBudget" DECIMAL(18,2) NOT NULL DEFAULT 10.00,
    "monthlyBudget" DECIMAL(18,2) NOT NULL DEFAULT 100.00,
    "tokenBudget" INTEGER NOT NULL DEFAULT 1000000,
    "requestBudget" INTEGER NOT NULL DEFAULT 1000,
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fallbackProviders" TEXT[] DEFAULT ARRAY['ANTHROPIC', 'GEMINI', 'OLLAMA']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usages" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_histories_userId_createdAt_idx" ON "ai_histories"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_histories_provider_model_idx" ON "ai_histories"("provider", "model");

-- CreateIndex
CREATE INDEX "ai_memories_userId_type_idx" ON "ai_memories"("userId", "type");

-- CreateIndex
CREATE INDEX "ai_memories_expiresAt_idx" ON "ai_memories"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_memories_userId_key_key" ON "ai_memories"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_configurations_userId_key" ON "ai_configurations"("userId");

-- CreateIndex
CREATE INDEX "ai_usages_userId_date_idx" ON "ai_usages"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usages_userId_date_key" ON "ai_usages"("userId", "date");

-- AddForeignKey
ALTER TABLE "ai_histories" ADD CONSTRAINT "ai_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usages" ADD CONSTRAINT "ai_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
