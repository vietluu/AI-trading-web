import type { ExchangeProvider } from "../../exchange/domain/exchange.types";
import type { MarketIncidentCode } from "./market-data.enums";

export class MarketDataError extends Error {
  constructor(
    readonly code: MarketIncidentCode,
    readonly provider: ExchangeProvider,
    message: string,
    readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}
