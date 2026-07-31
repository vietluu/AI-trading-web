ALTER TYPE "CredentialProvider" ADD VALUE 'BINANCE_FUTURES';
ALTER TYPE "CredentialProvider" ADD VALUE 'OKX_FUTURES';

CREATE TYPE "ExchangeProvider" AS ENUM ('BINANCE_FUTURES', 'OKX_FUTURES');
CREATE TYPE "ExchangeEnvironment" AS ENUM ('TESTNET', 'DEMO', 'PRODUCTION');

CREATE TABLE "exchange_connections" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "environment" "ExchangeEnvironment" NOT NULL,
  "credentialId" UUID NOT NULL,
  "displayName" TEXT,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "permissions" JSONB,
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exchange_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_connections_credentialId_key" ON "exchange_connections"("credentialId");
CREATE UNIQUE INDEX "exchange_connections_userId_provider_environment_key" ON "exchange_connections"("userId", "provider", "environment");
CREATE INDEX "exchange_connections_userId_idx" ON "exchange_connections"("userId");
CREATE INDEX "exchange_connections_provider_environment_idx" ON "exchange_connections"("provider", "environment");

ALTER TABLE "exchange_connections" ADD CONSTRAINT "exchange_connections_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exchange_connections" ADD CONSTRAINT "exchange_connections_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "encrypted_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
