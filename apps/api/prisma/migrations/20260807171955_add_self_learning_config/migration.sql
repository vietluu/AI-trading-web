-- CreateTable
CREATE TABLE "self_learning_configurations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 60.0,
    "volatilityPenalty" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "weightsJson" JSONB,
    "shadowWeightsJson" JSONB,
    "shadowThreshold" DOUBLE PRECISION,
    "shadowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shadowPerformance" JSONB,
    "lastOptimizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_learning_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "self_learning_configurations_userId_key" ON "self_learning_configurations"("userId");

-- AddForeignKey
ALTER TABLE "self_learning_configurations" ADD CONSTRAINT "self_learning_configurations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
