ALTER TABLE "users"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3);

-- Existing accounts predate verification and remain valid when the feature is enabled.
UPDATE "users" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "sessions"
  ADD COLUMN "tokenFamily" TEXT,
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "csrfHash" TEXT,
  ADD COLUMN "fingerprint" TEXT,
  ADD COLUMN "rememberMe" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "rotatedAt" TIMESTAMP(3);

-- Existing cookies cannot satisfy the new CSRF and fingerprint contract.
-- Revoke them once during deployment instead of manufacturing weak placeholders.
DELETE FROM "sessions";

ALTER TABLE "sessions"
  ALTER COLUMN "tokenFamily" SET NOT NULL,
  ALTER COLUMN "csrfHash" SET NOT NULL,
  ALTER COLUMN "fingerprint" SET NOT NULL;

CREATE INDEX "sessions_tokenFamily_idx" ON "sessions"("tokenFamily");
