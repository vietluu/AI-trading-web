ALTER TABLE "user_settings"
ADD COLUMN "maxRiskPerTrade" DECIMAL(6,5) NOT NULL DEFAULT 0.02;

UPDATE "user_settings"
SET "maxRiskPerTrade" = LEAST("maxRiskPerTrade", 0.02);
