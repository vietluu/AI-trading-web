import { ExchangeError } from "../domain/exchange.error";
import { ExchangeInterval, ExchangeProvider } from "../domain/exchange.types";

const binanceIntervals = new Set<string>(Object.values(ExchangeInterval));
const okxIntervals: Partial<Record<ExchangeInterval, string>> = {
  [ExchangeInterval.ONE_MINUTE]: "1m",
  [ExchangeInterval.THREE_MINUTES]: "3m",
  [ExchangeInterval.FIVE_MINUTES]: "5m",
  [ExchangeInterval.FIFTEEN_MINUTES]: "15m",
  [ExchangeInterval.THIRTY_MINUTES]: "30m",
  [ExchangeInterval.ONE_HOUR]: "1H",
  [ExchangeInterval.TWO_HOURS]: "2H",
  [ExchangeInterval.FOUR_HOURS]: "4H",
  [ExchangeInterval.SIX_HOURS]: "6H",
  [ExchangeInterval.TWELVE_HOURS]: "12H",
  [ExchangeInterval.ONE_DAY]: "1Dutc",
  [ExchangeInterval.ONE_WEEK]: "1Wutc",
  [ExchangeInterval.ONE_MONTH]: "1Mutc",
};

export function toBinanceInterval(interval: ExchangeInterval): string {
  if (!binanceIntervals.has(interval)) {
    throw ExchangeError.invalidRequest(
      ExchangeProvider.BINANCE_FUTURES,
      "Unsupported Binance interval",
    );
  }
  return interval;
}

export function toOkxInterval(interval: ExchangeInterval): string {
  const mapped = okxIntervals[interval];
  if (!mapped) {
    throw ExchangeError.invalidRequest(
      ExchangeProvider.OKX_FUTURES,
      "Unsupported OKX interval",
    );
  }
  return mapped;
}
