import { ExchangeError } from "../domain/exchange.error";
import { ExchangeProvider } from "../domain/exchange.types";

const normalizedPattern = /^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/;

export type ExchangeLike = ExchangeProvider | "OKX" | "BINANCE";

export interface SymbolConfig {
  symbol: string;
  exchange: "OKX" | "BINANCE";
  enabled?: boolean;
}

export const DEFAULT_SYMBOL_REGISTRY: SymbolConfig[] = [
  { symbol: "BTC-USDT", exchange: "OKX", enabled: true },
  { symbol: "ETH-USDT", exchange: "OKX", enabled: true },
  { symbol: "SOL-USDT", exchange: "OKX", enabled: true },
  { symbol: "BNB-USDT", exchange: "OKX", enabled: true },
  { symbol: "XRP-USDT", exchange: "OKX", enabled: true },
];

export function normalizeSymbol(
  symbol: string,
  provider = ExchangeProvider.BINANCE_FUTURES,
): string {
  const trimmed = symbol?.trim();
  if (!trimmed) {
    throw ExchangeError.invalidRequest(provider, "Symbol must not be empty");
  }
  const normalized = trimmed.toUpperCase();
  if (!normalizedPattern.test(normalized)) {
    throw ExchangeError.invalidRequest(
      provider,
      "Symbol must use normalized BASE-QUOTE format",
    );
  }
  return normalized;
}

function isOkxExchange(exchange: ExchangeLike): boolean {
  return (
    exchange === ExchangeProvider.OKX_FUTURES ||
    exchange === "OKX"
  );
}

export function mapSymbol(
  symbol: string,
  exchange: ExchangeLike = ExchangeProvider.BINANCE_FUTURES,
): string {
  const provider = isOkxExchange(exchange)
    ? ExchangeProvider.OKX_FUTURES
    : ExchangeProvider.BINANCE_FUTURES;
  const normalized = normalizeSymbol(symbol, provider);
  return normalizeSymbolForExchange(normalized, exchange);
}

export function canonicalSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith("-SWAP")) return normalized.slice(0, -5);
  return normalized.includes("-") ? normalized : normalized;
}

export function normalizeSymbolForExchange(
  symbol: string,
  exchange: ExchangeLike = ExchangeProvider.BINANCE_FUTURES,
): string {
  const normalized = canonicalSymbol(symbol);
  if (isOkxExchange(exchange)) {
    const trimmed = normalized.replace(/-SWAP$/u, "");
    return `${trimmed}-SWAP`;
  }
  return normalized.replace("-", "");
}

export function toBinanceSymbol(symbol: string): string {
  return normalizeSymbolForExchange(symbol, ExchangeProvider.BINANCE_FUTURES);
}

export function toOkxSymbol(symbol: string): string {
  return normalizeSymbolForExchange(symbol, ExchangeProvider.OKX_FUTURES);
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

export function resolveDefaultSymbols(symbols?: string[]): string[] {
  const configured = Array.isArray(symbols) ? symbols : [];
  if (configured.length > 0) return configured.map((item) => normalizeSymbol(item));
  return DEFAULT_SYMBOL_REGISTRY.filter((item) => item.enabled !== false).map(
    (item) => item.symbol,
  );
}
