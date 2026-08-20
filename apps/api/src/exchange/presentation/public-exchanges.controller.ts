import { Controller, Get, Param, ParseEnumPipe, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import {
  DepthQueryDto,
  InstrumentQueryDto,
  KlineQueryDto,
  LimitQueryDto,
} from "../application/exchange-connection.dto";
import { PublicExchangeService } from "../application/public-exchange.service";
import { ExchangeProvider } from "../domain/exchange.types";

@ApiTags("exchanges")
@Controller("exchanges")
export class PublicExchangesController {
  constructor(private readonly exchanges: PublicExchangeService) {}

  @Get("providers")
  providers() {
    return this.exchanges.providers();
  }

  @Get("symbols")
  symbols(@Query("provider") provider?: ExchangeProvider) {
    if (provider) {
      return this.exchanges.providerSymbols(provider);
    }
    return this.exchanges.crossExchangeSymbols();
  }

  @Get("recommendations")
  recommendations(
    @Query("provider") provider?: ExchangeProvider,
    @Query("limit") limit?: string,
    @Query("commonOnly") commonOnly?: string,
  ) {
    return this.exchanges.recommendTopSymbols({
      provider,
      limit: limit ? Number(limit) : 10,
      commonOnly: commonOnly === "true",
    });
  }

  @Get(":provider/time")
  time(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
  ) {
    return this.exchanges.time(provider);
  }

  @Get(":provider/instruments")
  instruments(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Query() query: InstrumentQueryDto,
  ) {
    return this.exchanges.instruments(provider, query.status);
  }

  @Get(":provider/instruments/:symbol")
  instrument(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
  ) {
    return this.exchanges.instrument(provider, symbol);
  }

  @Get(":provider/ticker/:symbol")
  ticker(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
  ) {
    return this.exchanges.ticker(provider, symbol);
  }

  @Get(":provider/order-book/:symbol")
  orderBook(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
    @Query() query: DepthQueryDto,
  ) {
    return this.exchanges.orderBook(provider, symbol, query.depth);
  }

  @Get(":provider/trades/:symbol")
  trades(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
    @Query() query: LimitQueryDto,
  ) {
    return this.exchanges.trades(provider, symbol, query.limit);
  }

  @Get(":provider/klines/:symbol")
  klines(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
    @Query() query: KlineQueryDto,
  ) {
    return this.exchanges.klines(provider, {
      symbol,
      interval: query.interval,
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.startTime ? { startTime: query.startTime } : {}),
      ...(query.endTime ? { endTime: query.endTime } : {}),
    });
  }

  @Get(":provider/funding-rate/:symbol")
  funding(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
  ) {
    return this.exchanges.funding(provider, symbol);
  }

  @Get(":provider/open-interest/:symbol")
  openInterest(
    @Param("provider", new ParseEnumPipe(ExchangeProvider))
    provider: ExchangeProvider,
    @Param("symbol") symbol: string,
  ) {
    return this.exchanges.openInterest(provider, symbol);
  }
}
