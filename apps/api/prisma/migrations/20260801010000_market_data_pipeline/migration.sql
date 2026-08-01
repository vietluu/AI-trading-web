CREATE TYPE "MarketDataInterval" AS ENUM (
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h',
  '12h', '1d', '1w', '1M'
);

CREATE TYPE "GapStatus" AS ENUM (
  'DETECTED', 'REPAIRING', 'REPAIRED', 'FAILED', 'IGNORED'
);

CREATE TABLE "market_instruments" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT NOT NULL,
  "baseAsset" TEXT NOT NULL,
  "quoteAsset" TEXT NOT NULL,
  "settlementAsset" TEXT NOT NULL,
  "instrumentType" TEXT NOT NULL DEFAULT 'PERPETUAL',
  "status" TEXT NOT NULL DEFAULT 'TRADING',
  "pricePrecision" INTEGER NOT NULL,
  "quantityPrecision" INTEGER NOT NULL,
  "tickSize" DECIMAL(24,8) NOT NULL,
  "stepSize" DECIMAL(24,8) NOT NULL,
  "minQuantity" DECIMAL(24,8),
  "maxQuantity" DECIMAL(24,8),
  "minNotional" DECIMAL(24,8),
  "contractSize" DECIMAL(24,8),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_instruments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_candles" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT NOT NULL,
  "interval" "MarketDataInterval" NOT NULL,
  "openTime" TIMESTAMP(3) NOT NULL,
  "closeTime" TIMESTAMP(3) NOT NULL,
  "open" DECIMAL(24,8) NOT NULL,
  "high" DECIMAL(24,8) NOT NULL,
  "low" DECIMAL(24,8) NOT NULL,
  "close" DECIMAL(24,8) NOT NULL,
  "volume" DECIMAL(36,8) NOT NULL,
  "quoteVolume" DECIMAL(36,8),
  "tradeCount" INTEGER,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_candles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_rate_snapshots" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT NOT NULL,
  "fundingRate" DECIMAL(24,12) NOT NULL,
  "fundingTime" TIMESTAMP(3) NOT NULL,
  "nextFundingTime" TIMESTAMP(3),
  "markPrice" DECIMAL(24,8),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_rate_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "open_interest_snapshots" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT NOT NULL,
  "openInterest" DECIMAL(36,8) NOT NULL,
  "openInterestValue" DECIMAL(36,8),
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "open_interest_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_data_gaps" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT NOT NULL,
  "interval" "MarketDataInterval" NOT NULL,
  "gapStart" TIMESTAMP(3) NOT NULL,
  "gapEnd" TIMESTAMP(3) NOT NULL,
  "status" "GapStatus" NOT NULL DEFAULT 'DETECTED',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_data_gaps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_stream_incidents" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT,
  "code" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_stream_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "indicator_snapshots" (
  "id" UUID NOT NULL,
  "provider" "ExchangeProvider" NOT NULL,
  "symbol" TEXT NOT NULL,
  "interval" "MarketDataInterval" NOT NULL,
  "candleOpenTime" TIMESTAMP(3) NOT NULL,
  "candleCloseTime" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CLOSED',
  "values" JSONB NOT NULL,
  "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "indicator_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_instruments_provider_symbol_key" ON "market_instruments"("provider", "symbol");
CREATE INDEX "market_instruments_provider_status_idx" ON "market_instruments"("provider", "status");
CREATE UNIQUE INDEX "market_candles_provider_symbol_interval_openTime_key" ON "market_candles"("provider", "symbol", "interval", "openTime");
CREATE INDEX "market_candles_symbol_openTime_idx" ON "market_candles"("symbol", "openTime");
CREATE INDEX "market_candles_provider_symbol_interval_openTime_idx" ON "market_candles"("provider", "symbol", "interval", "openTime");
CREATE UNIQUE INDEX "funding_rate_snapshots_provider_symbol_fundingTime_key" ON "funding_rate_snapshots"("provider", "symbol", "fundingTime");
CREATE INDEX "funding_rate_snapshots_provider_symbol_fundingTime_idx" ON "funding_rate_snapshots"("provider", "symbol", "fundingTime");
CREATE UNIQUE INDEX "open_interest_snapshots_provider_symbol_recordedAt_key" ON "open_interest_snapshots"("provider", "symbol", "recordedAt");
CREATE INDEX "open_interest_snapshots_provider_symbol_recordedAt_idx" ON "open_interest_snapshots"("provider", "symbol", "recordedAt");
CREATE UNIQUE INDEX "market_data_gaps_provider_symbol_interval_gapStart_key" ON "market_data_gaps"("provider", "symbol", "interval", "gapStart");
CREATE INDEX "market_data_gaps_provider_symbol_interval_status_idx" ON "market_data_gaps"("provider", "symbol", "interval", "status");
CREATE INDEX "market_stream_incidents_provider_code_createdAt_idx" ON "market_stream_incidents"("provider", "code", "createdAt");
CREATE INDEX "market_stream_incidents_createdAt_idx" ON "market_stream_incidents"("createdAt");
CREATE UNIQUE INDEX "indicator_snapshots_provider_symbol_interval_candleOpenTime_status_key" ON "indicator_snapshots"("provider", "symbol", "interval", "candleOpenTime", "status");
CREATE INDEX "indicator_snapshots_provider_symbol_interval_candleOpenTime_idx" ON "indicator_snapshots"("provider", "symbol", "interval", "candleOpenTime");
