ALTER TABLE "quant_hypotheses" ADD COLUMN "symbol" TEXT;

UPDATE "quant_hypotheses"
SET "symbol" = "provenance"->>'symbol'
WHERE "provenance" IS NOT NULL AND "provenance"->>'symbol' IS NOT NULL;

CREATE INDEX "quant_hypotheses_userId_symbol_category_createdAt_idx"
ON "quant_hypotheses"("userId", "symbol", "category", "createdAt");
