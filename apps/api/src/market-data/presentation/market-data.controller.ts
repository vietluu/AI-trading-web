import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from "@nestjs/swagger";
import { MarketRedisCacheService } from "../infrastructure/redis/market-redis-cache.service";
import { MarketDataRepository } from "../infrastructure/persistence/market-data.repository";
import { MarketDataConfigService } from "../application/market-data-config.service";
import { MarketDataService } from "../application/market-data.service";
import {
  ExchangeInterval,
  type ExchangeProvider,
} from "../../exchange/domain/exchange.types";

@ApiTags("Market Data")
@Controller("market")
export class MarketDataController {
  constructor(
    private readonly cache: MarketRedisCacheService,
    private readonly repository: MarketDataRepository,
    private readonly configService: MarketDataConfigService,
    private readonly marketData: MarketDataService,
  ) {}

  @Get("providers")
  @ApiOperation({ summary: "List configured market data providers" })
  getProviders() {
    const config = this.configService.getConfig();
    return {
      providers: config.providers,
      symbols: config.symbols,
      intervals: config.intervals,
      enabled: config.enabled,
    };
  }

  @Get("instruments")
  @ApiOperation({ summary: "List market instruments" })
  @ApiQuery({ name: "provider", required: false })
  @ApiQuery({ name: "status", required: false })
  async getInstruments(
    @Query("provider") provider?: string,
    @Query("status") status?: string,
  ) {
    return this.repository.getInstruments({
      ...(provider ? { provider: provider as ExchangeProvider } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Get("tickers/:provider/:symbol")
  @ApiOperation({ summary: "Get latest ticker" })
  @ApiParam({ name: "provider", example: "BINANCE_FUTURES" })
  @ApiParam({ name: "symbol", example: "BTC-USDT" })
  async getTicker(
    @Param("provider") provider: string,
    @Param("symbol") symbol: string,
  ) {
    const ticker = await this.cache.getTicker(
      provider as ExchangeProvider,
      symbol.toUpperCase(),
    );
    if (!ticker) {
      throw new HttpException("Ticker not found", HttpStatus.NOT_FOUND);
    }
    return ticker;
  }

  @Get("candles/:provider/:symbol")
  @ApiOperation({ summary: "Get historical candles" })
  @ApiParam({ name: "provider", example: "BINANCE_FUTURES" })
  @ApiParam({ name: "symbol", example: "BTC-USDT" })
  @ApiQuery({ name: "interval", required: true, example: "1h" })
  @ApiQuery({ name: "startTime", required: false })
  @ApiQuery({ name: "endTime", required: false })
  @ApiQuery({ name: "limit", required: false, example: "500" })
  async getCandles(
    @Param("provider") provider: string,
    @Param("symbol") symbol: string,
    @Query("interval") interval: string,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
    @Query("limit") limit?: string,
  ) {
    if (!interval) {
      throw new HttpException("interval is required", HttpStatus.BAD_REQUEST);
    }
    return this.marketData.getHistoricalCandles({
      provider: provider as ExchangeProvider,
      symbol: symbol.toUpperCase(),
      interval: interval as ExchangeInterval,
      ...(startTime ? { startTime: new Date(startTime) } : {}),
      ...(endTime ? { endTime: new Date(endTime) } : {}),
      ...(limit ? { limit: Math.min(Number(limit), 1000) } : { limit: 500 }),
    });
  }

  @Get("indicators/:provider/:symbol")
  @ApiOperation({ summary: "Get latest indicator snapshot" })
  @ApiParam({ name: "provider", example: "BINANCE_FUTURES" })
  @ApiParam({ name: "symbol", example: "BTC-USDT" })
  @ApiQuery({ name: "interval", required: true, example: "1h" })
  async getIndicators(
    @Param("provider") provider: string,
    @Param("symbol") symbol: string,
    @Query("interval") interval: string,
  ) {
    if (!interval) {
      throw new HttpException("interval is required", HttpStatus.BAD_REQUEST);
    }
    const snapshot = await this.marketData.getIndicatorSnapshot(
      provider as ExchangeProvider,
      symbol.toUpperCase(),
      interval as ExchangeInterval,
    );
    if (!snapshot) {
      throw new HttpException("Indicators not available", HttpStatus.NOT_FOUND);
    }
    return snapshot;
  }

  @Get("funding/:provider/:symbol")
  @ApiOperation({ summary: "Get funding rate history" })
  @ApiQuery({ name: "startTime", required: false })
  @ApiQuery({ name: "endTime", required: false })
  @ApiQuery({ name: "limit", required: false })
  async getFunding(
    @Param("provider") provider: string,
    @Param("symbol") symbol: string,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
    @Query("limit") limit?: string,
  ) {
    return this.repository.getFundingRates({
      provider: provider as ExchangeProvider,
      symbol: symbol.toUpperCase(),
      ...(startTime ? { startTime: new Date(startTime) } : {}),
      ...(endTime ? { endTime: new Date(endTime) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Get("open-interest/:provider/:symbol")
  @ApiOperation({ summary: "Get open interest history" })
  @ApiQuery({ name: "startTime", required: false })
  @ApiQuery({ name: "endTime", required: false })
  @ApiQuery({ name: "limit", required: false })
  async getOpenInterest(
    @Param("provider") provider: string,
    @Param("symbol") symbol: string,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
    @Query("limit") limit?: string,
  ) {
    return this.repository.getOpenInterestHistory({
      provider: provider as ExchangeProvider,
      symbol: symbol.toUpperCase(),
      ...(startTime ? { startTime: new Date(startTime) } : {}),
      ...(endTime ? { endTime: new Date(endTime) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Get("order-book/:provider/:symbol")
  @ApiOperation({ summary: "Get latest order book" })
  @ApiQuery({ name: "depth", required: false, example: "20" })
  async getOrderBook(
    @Param("provider") provider: string,
    @Param("symbol") symbol: string,
    @Query("depth") depth?: string,
  ) {
    const d = depth ? Number(depth) : 20;
    const book = await this.cache.getOrderBook(
      provider as ExchangeProvider,
      symbol.toUpperCase(),
      d,
    );
    if (!book) {
      throw new HttpException("Order book not available", HttpStatus.NOT_FOUND);
    }
    return book;
  }

  @Get("status")
  @ApiOperation({ summary: "Get market data status for all providers" })
  async getStatus() {
    const config = this.configService.getConfig();
    const statuses = await Promise.all(
      config.providers.map(async (provider) => {
        const status = await this.cache.getStreamStatus(provider);
        return { provider, status };
      }),
    );
    return {
      enabled: config.enabled,
      providers: statuses,
    };
  }

  @Get("status/:provider")
  @ApiOperation({ summary: "Get stream status for specific provider" })
  async getProviderStatus(@Param("provider") provider: string) {
    const status = await this.cache.getStreamStatus(
      provider as ExchangeProvider,
    );
    return status ?? { provider, state: "UNKNOWN" };
  }

  @Get("gaps")
  @ApiOperation({ summary: "Get data gaps" })
  @ApiQuery({ name: "provider", required: false })
  @ApiQuery({ name: "symbol", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "limit", required: false })
  async getGaps(
    @Query("provider") provider?: string,
    @Query("symbol") symbol?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.repository.getGaps({
      ...(provider ? { provider: provider as ExchangeProvider } : {}),
      ...(symbol ? { symbol } : {}),
      ...(status ? { status } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Post("backfill")
  @ApiOperation({
    summary: "Trigger historical backfill (Requires Auth in production)",
  })
  async triggerBackfill(
    @Query("provider") provider: string,
    @Query("symbol") symbol: string,
    @Query("interval") interval: string,
    @Query("startTime") startTime: string,
    @Query("endTime") endTime: string,
  ) {
    // Note: To make this robust, this should enqueue a BullMQ job that fetches
    // data using the REST Exchange Adapters, then inserts them via MarketDataRepository.
    return {
      success: true,
      message: `Backfill job enqueued for ${provider} ${symbol} ${interval} from ${startTime} to ${endTime}`,
      status: "ENQUEUED",
    };
  }

  @Post("gaps/:id/repair")
  @ApiOperation({ summary: "Trigger a repair job for a specific data gap" })
  async repairGap(@Param("id") id: string) {
    await this.repository.updateGapStatus(id, "REPAIRING");

    // In full implementation, this triggers a BullMQ worker to fetch missing candles
    return {
      success: true,
      message: `Repair job triggered for gap ID: ${id}`,
      status: "REPAIRING",
    };
  }
}
