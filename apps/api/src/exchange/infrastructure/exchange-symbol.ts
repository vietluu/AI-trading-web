import { ExchangeError } from "../domain/exchange.error";
import { ExchangeProvider } from "../domain/exchange.types";

const normalizedPattern = /^[A-Z0-9_]{1,40}-[A-Z0-9_]{1,40}$/;
const slashPattern = /^[A-Z0-9_]{1,40}\/[A-Z0-9_]{1,40}$/;
const swapPattern = /^[A-Z0-9_]{1,40}-[A-Z0-9_]{1,40}-SWAP$/;
const compactQuotePattern = /^([A-Z0-9_]{1,40})(USDT|USDC|USD|BTC|ETH|BNB|BUSD|FDUSD|EUR|GBP|JPY)$/;

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
  const collapsed = normalized.replace(/\s+/gu, "");
  const withoutSwap = collapsed.replace(/-SWAP$/u, "");

  const hyphenParts = withoutSwap.split("-");
  if (hyphenParts.length === 2 && hyphenParts[0] && hyphenParts[1]) {
    const candidate = `${hyphenParts[0]}-${hyphenParts[1]}`;
    if (normalizedPattern.test(candidate)) {
      return candidate;
    }
  }

  const slashParts = withoutSwap.split("/");
  if (slashParts.length === 2 && slashParts[0] && slashParts[1]) {
    const candidate = `${slashParts[0]}-${slashParts[1]}`;
    if (normalizedPattern.test(candidate)) {
      return candidate;
    }
  }

  const compactMatch = withoutSwap.match(compactQuotePattern);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}`;
  }

  const underscoreParts = withoutSwap.split("_");
  if (underscoreParts.length === 2 && underscoreParts[0] && underscoreParts[1]) {
    const candidate = `${underscoreParts[0]}-${underscoreParts[1]}`;
    if (normalizedPattern.test(candidate)) {
      return candidate;
    }
  }

  const candidate = withoutSwap.replace(/[/_.-]+/gu, "-");
  if (
    !normalizedPattern.test(candidate) &&
    !slashPattern.test(normalized) &&
    !swapPattern.test(normalized)
  ) {
    throw ExchangeError.invalidRequest(
      provider,
      "Symbol must use normalized BASE-QUOTE format",
    );
  }
  return candidate;
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
  if (!/^[A-Z0-9_]+-[A-Z0-9_]+-SWAP$/i.test(symbol)) {
    throw ExchangeError.invalidRequest(
      ExchangeProvider.OKX_FUTURES,
      `Unexpected OKX swap symbol: ${symbol || "<empty>"}`,
    );
  }
  return symbol.slice(0, -5).toUpperCase();
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
