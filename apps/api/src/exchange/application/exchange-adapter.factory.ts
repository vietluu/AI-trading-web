import { Injectable } from "@nestjs/common";

import type { ExchangeAdapter } from "../domain/exchange.adapter";
import { ExchangeError } from "../domain/exchange.error";
import { ExchangeProvider } from "../domain/exchange.types";
import { BinanceFuturesAdapter } from "../infrastructure/binance/binance-futures.adapter";
import { OkxFuturesAdapter } from "../infrastructure/okx/okx-futures.adapter";

@Injectable()
export class ExchangeAdapterFactory {
  constructor(
    private readonly binance: BinanceFuturesAdapter,
    private readonly okx: OkxFuturesAdapter,
  ) {}

  get(provider: ExchangeProvider): ExchangeAdapter {
    if (provider === ExchangeProvider.BINANCE_FUTURES) return this.binance;
    if (provider === ExchangeProvider.OKX_FUTURES) return this.okx;
    throw ExchangeError.invalidRequest(
      provider,
      "Unsupported exchange provider",
    );
  }
}
