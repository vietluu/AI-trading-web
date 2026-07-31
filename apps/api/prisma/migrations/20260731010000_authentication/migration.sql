CREATE TYPE "CredentialProvider" AS ENUM ('OPENAI', 'BINANCE', 'OKX', 'NEWS_API', 'CUSTOM');

CREATE TABLE "users" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL, "failedLogins" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE TABLE "sessions" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "sessionId" TEXT NOT NULL,
  "ip" TEXT, "userAgent" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_sessionId_key" ON "sessions"("sessionId");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

CREATE TABLE "encrypted_credentials" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "provider" "CredentialProvider" NOT NULL,
  "label" TEXT, "encryptedData" TEXT NOT NULL, "lastFour" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_VERIFIED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "lastVerified" TIMESTAMP(3),
  CONSTRAINT "encrypted_credentials_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "encrypted_credentials_userId_idx" ON "encrypted_credentials"("userId");
CREATE UNIQUE INDEX "encrypted_credentials_userId_provider_label_key" ON "encrypted_credentials"("userId", "provider", "label");

CREATE TABLE "user_settings" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "theme" TEXT NOT NULL DEFAULT 'dark',
  "timezone" TEXT NOT NULL DEFAULT 'UTC', "preferredExchange" TEXT,
  "preferredSymbols" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "preferredTimeframes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "aiDailyBudget" DECIMAL(18,2) NOT NULL DEFAULT 0, "paperTradingBalance" DECIMAL(24,8) NOT NULL DEFAULT 10000,
  "defaultLeverage" INTEGER NOT NULL DEFAULT 1, "riskPreference" TEXT NOT NULL DEFAULT 'CONSERVATIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL, "userId" UUID, "action" TEXT NOT NULL, "ip" TEXT,
  "userAgent" TEXT, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "encrypted_credentials" ADD CONSTRAINT "encrypted_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
