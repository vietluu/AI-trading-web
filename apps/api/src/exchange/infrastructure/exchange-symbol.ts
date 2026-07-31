import { ExchangeError } from "../domain/exchange.error";
import { ExchangeProvider } from "../domain/exchange.types";

const normalizedPattern = /^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/;

export function normalizeSymbol(
  symbol: string,
  provider = ExchangeProvider.BINANCE_FUTURES,
): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalizedPattern.test(normalized)) {
    throw ExchangeError.invalidRequest(
      provider,
      "Symbol must use normalized BASE-QUOTE format",
    );
  }
  return normalized;
}

export function toBinanceSymbol(symbol: string): string {
  return normalizeSymbol(symbol).replace("-", "");
}

export function toOkxSymbol(symbol: string): string {
  return `${normalizeSymbol(symbol, ExchangeProvider.OKX_FUTURES)}-SWAP`;
}

export function fromOkxSymbol(symbol: string): string {
  if (!/^[A-Z0-9]+-[A-Z0-9]+-SWAP$/.test(symbol)) {
    throw ExchangeError.invalidRequest(
      ExchangeProvider.OKX_FUTURES,
      "Unexpected OKX swap symbol",
    );
  }
  return symbol.slice(0, -5);
}

export function fromAssets(baseAsset: string, quoteAsset: string): string {
  return normalizeSymbol(`${baseAsset}-${quoteAsset}`);
}
