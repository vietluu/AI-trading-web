ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'SHADOW';
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'CANARY';

ALTER TABLE "self_learning_experiments"
ADD COLUMN "recommendationId" UUID;

CREATE UNIQUE INDEX "self_learning_experiments_recommendationId_key"
ON "self_learning_experiments"("recommendationId");

ALTER TABLE "self_learning_experiments"
ADD CONSTRAINT "self_learning_experiments_recommendationId_fkey"
FOREIGN KEY ("recommendationId") REFERENCES "quant_recommendations"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
