import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CredentialModule } from "../credentials/credential.module";
import { ExchangeAdapterFactory } from "./application/exchange-adapter.factory";
import { ExchangeConnectionRepository } from "./application/exchange-connection.repository";
import { ExchangeRealtimeService } from "./application/exchange-realtime.service";
import { ExchangeConnectionService } from "./application/exchange-connection.service";
import { PublicExchangeService } from "./application/public-exchange.service";
import { BinanceFuturesAdapter } from "./infrastructure/binance/binance-futures.adapter";
import { BinanceFuturesClient } from "./infrastructure/binance/binance-futures.client";
import { BinanceSignatureService } from "./infrastructure/binance/binance-signature.service";
import { ExchangeCacheService } from "./infrastructure/exchange-cache.service";
import { ExchangeHttpService } from "./infrastructure/exchange-http.service";
import { ExchangeRateLimitService } from "./infrastructure/exchange-rate-limit.service";
import { ExchangeTimeService } from "./infrastructure/exchange-time.service";
import { OkxFuturesAdapter } from "./infrastructure/okx/okx-futures.adapter";
import { OkxFuturesClient } from "./infrastructure/okx/okx-futures.client";
import { OkxSignatureService } from "./infrastructure/okx/okx-signature.service";
import { OkxPrivateStreamService } from "./infrastructure/okx/okx-private-stream.service";
import { ExchangeConnectionsController } from "./presentation/exchange-connections.controller";
import { PublicExchangesController } from "./presentation/public-exchanges.controller";
import { MarketStreamsModule } from "../market-data/market-streams.module";

@Module({
  imports: [AuthModule, CredentialModule, MarketStreamsModule],
  controllers: [ExchangeConnectionsController, PublicExchangesController],
  providers: [
    ExchangeAdapterFactory,
    ExchangeConnectionRepository,
    ExchangeConnectionService,
    PublicExchangeService,
    ExchangeRealtimeService,
    ExchangeHttpService,
    ExchangeTimeService,
    ExchangeRateLimitService,
    ExchangeCacheService,
    BinanceSignatureService,
    BinanceFuturesClient,
    BinanceFuturesAdapter,
    OkxSignatureService,
    OkxPrivateStreamService,
    OkxFuturesClient,
    OkxFuturesAdapter,
  ],
  exports: [PublicExchangeService, ExchangeConnectionService, ExchangeRealtimeService],
})
export class ExchangeModule {}
