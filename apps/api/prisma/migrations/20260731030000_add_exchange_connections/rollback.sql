DELETE FROM "encrypted_credentials"
WHERE "id" IN (SELECT "credentialId" FROM "exchange_connections");
DROP TABLE IF EXISTS "exchange_connections";
DROP TYPE IF EXISTS "ExchangeEnvironment";
DROP TYPE IF EXISTS "ExchangeProvider";
ALTER TABLE "encrypted_credentials"
  ALTER COLUMN "provider" TYPE TEXT USING "provider"::TEXT;
DROP TYPE "CredentialProvider";
CREATE TYPE "CredentialProvider" AS ENUM (
  'OPENAI', 'BINANCE', 'OKX', 'NEWS_API', 'CUSTOM'
);
ALTER TABLE "encrypted_credentials"
  ALTER COLUMN "provider" TYPE "CredentialProvider"
  USING "provider"::"CredentialProvider";
