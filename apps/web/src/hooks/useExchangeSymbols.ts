import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";

export interface ExchangeSymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  binanceSupported: boolean;
  okxSupported: boolean;
  isCommon: boolean;
}

const FALLBACK_SYMBOLS: ExchangeSymbolInfo[] = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "BNB-USDT",
  "XRP-USDT",
  "DOGE-USDT",
  "ADA-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "NEAR-USDT",
  "SUI-USDT",
].map((symbol) => ({
  symbol,
  baseAsset: symbol.split("-")[0]!,
  quoteAsset: "USDT",
  binanceSupported: true,
  okxSupported: true,
  isCommon: true,
}));

export function useExchangeSymbols(provider?: string) {
  return useQuerySymbolsInternal(provider);
}

const MAJOR_ORDER = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "BNB-USDT",
  "XRP-USDT",
  "DOGE-USDT",
  "ADA-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "NEAR-USDT",
  "SUI-USDT",
  "PEPE-USDT",
  "SHIB-USDT",
  "WIF-USDT",
  "APT-USDT",
  "OP-USDT",
  "ARB-USDT",
  "INJ-USDT",
  "TIA-USDT",
  "RENDER-USDT",
  "FET-USDT",
  "FLOKI-USDT",
];

function sortPrioritized(list: string[]): string[] {
  const majorSet = new Set(MAJOR_ORDER);
  const majorsInList = MAJOR_ORDER.filter((s) => list.includes(s));
  const others = list.filter((s) => !majorSet.has(s)).sort((a, b) => a.localeCompare(b));
  return Array.from(new Set([...majorsInList, ...others]));
}

function useQuerySymbolsInternal(provider?: string) {
  const query = useQuery({
    queryKey: ["exchange-symbols", provider ?? "ALL"],
    queryFn: async (): Promise<ExchangeSymbolInfo[]> => {
      const url = provider
        ? `/exchanges/symbols?provider=${encodeURIComponent(provider)}`
        : "/exchanges/symbols";
      const data = await apiRequest<ExchangeSymbolInfo[]>(url);
      return Array.isArray(data) && data.length > 0 ? data : FALLBACK_SYMBOLS;
    },
    staleTime: 5 * 60 * 1000,
  });

  const rawSymbols = query.data?.map((s) => s.symbol) ?? FALLBACK_SYMBOLS.map((s) => s.symbol);
  const symbols = sortPrioritized(rawSymbols);

  return {
    ...query,
    symbols,
    symbolObjects: query.data ?? FALLBACK_SYMBOLS,
  };
}
