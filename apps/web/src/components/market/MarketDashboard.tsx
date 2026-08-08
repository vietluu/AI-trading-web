"use client";

import type { CandlestickData, Time } from "lightweight-charts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  Loader2,
  Radio,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

import { TradingChart } from "./TradingChart";

type MarketProvider = "BINANCE_FUTURES" | "OKX_FUTURES";

interface TickerData {
  provider: MarketProvider;
  symbol: string;
  lastPrice: string;
  bidPrice?: string;
  askPrice?: string;
  volume24h?: string;
  high24h?: string;
  low24h?: string;
}

interface RawCandle {
  provider: MarketProvider;
  symbol: string;
  interval: string;
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface StreamStatus {
  provider: MarketProvider;
  state: string;
  lastMessageAt?: string;
  activeSubscriptions?: number;
  reconnectCount?: number;
  messageCount?: number;
  malformedMessageCount?: number;
}

interface IndicatorSnapshot {
  values: {
    sma20?: string;
    ema20?: string;
    rsi14?: string;
    atr14?: string;
    macd?: { value: string; signal: string; histogram: string };
  };
  calculatedAt?: string;
}

interface FundingRate {
  fundingRate: string;
  nextFundingTime?: string;
  markPrice?: string;
}

interface OpenInterest {
  openInterest: string;
  openInterestValue?: string;
  timestamp: string;
}

interface MarketDashboardProps {
  apiBaseUrl: string;
  defaultSymbol?: string;
  defaultInterval?: string;
}

const PROVIDERS: Array<{ value: MarketProvider; label: string }> = [
  { value: "OKX_FUTURES", label: "OKX Futures" },
  { value: "BINANCE_FUTURES", label: "Binance Futures" },
];
const SYMBOLS = [
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
] as const;
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const STALE_AFTER_MS = 35_000;

function toChartCandle(candle: RawCandle): CandlestickData {
  return {
    time: (new Date(candle.openTime).getTime() / 1000) as Time,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

function resolveMarketUrl(apiBaseUrl: string, path: string): string {
  const normalizedBase = apiBaseUrl.trim();
  return normalizedBase
    ? `${normalizedBase.replace(/\/$/, "")}${path}`
    : path;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    if (response.status === 451) {
      throw new Error(
        "Binance API (HTTP 451): Binance is geo-restricted in your current location or IP range. Switch to OKX Futures or use a VPN/Proxy.",
      );
    }
    throw new Error(`Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function formatNumber(value?: string, maximumFractionDigits = 2): string {
  if (value === undefined) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

import { useExchangeSymbols } from "@/hooks/useExchangeSymbols";

export function MarketDashboard({
  apiBaseUrl,
  defaultSymbol = "BTC-USDT",
  defaultInterval = "1h",
}: MarketDashboardProps): React.JSX.Element {
  const { symbols: dynamicSymbols } = useExchangeSymbols();
  const [provider, setProvider] = useState<MarketProvider>("OKX_FUTURES");
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [interval, setIntervalValue] = useState(defaultInterval);
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [historicalData, setHistoricalData] = useState<CandlestickData[]>([]);
  const [realtimeCandle, setRealtimeCandle] = useState<CandlestickData>();
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [indicators, setIndicators] = useState<IndicatorSnapshot | null>(null);
  const [funding, setFunding] = useState<FundingRate | null>(null);
  const [openInterest, setOpenInterest] = useState<OpenInterest | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastRealtimeAt, setLastRealtimeAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setHistoricalData([]);
    setRealtimeCandle(undefined);
    setTicker(null);
    setIndicators(null);
    setFunding(null);
    setOpenInterest(null);
    setLastRealtimeAt(null);

    const loadHistory = async (): Promise<void> => {
      try {
        const candles = await fetchJson<RawCandle[]>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/market/candles/${provider}/${symbol}?interval=${interval}&limit=500`,
          ),
          controller.signal,
        );
        setHistoricalData(candles.map(toChartCandle));

        const snapshot = await fetchJson<IndicatorSnapshot>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/market/indicators/${provider}/${symbol}?interval=${interval}`,
          ),
          controller.signal,
        ).catch(() => null);
        setIndicators(snapshot);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load market history",
          );
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadHistory();
    return () => controller.abort();
  }, [apiBaseUrl, interval, provider, symbol]);

  useEffect(() => {
    const socket = io(resolveMarketUrl(apiBaseUrl, "/market"), {
      path:
        typeof window !== "undefined"
          ? (window as Window & { __SOCKET_IO_PATH__?: string }).__SOCKET_IO_PATH__ ?? "/socket.io/"
          : "/socket.io/",
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 3_000,
      transports: ["websocket", "polling"],
      timeout: 3_000,
      forceNew: true,
    });
    const subscription = { provider, symbol };
    const candleSubscription = { provider, symbol, interval };

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("subscribe", { channel: "ticker", ...subscription });
      socket.emit("subscribe", {
        channel: "candle",
        ...candleSubscription,
      });
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));
    socket.on("ticker", (data: TickerData) => {
      if (data.provider === provider && data.symbol === symbol) {
        setTicker(data);
        setLastRealtimeAt(new Date());
      }
    });
    socket.on("candle", (data: RawCandle) => {
      if (
        data.provider === provider &&
        data.symbol === symbol &&
        data.interval === interval
      ) {
        setRealtimeCandle(toChartCandle(data));
        setLastRealtimeAt(new Date());
      }
    });

    return () => {
      socket.emit("unsubscribe", { channel: "ticker", ...subscription });
      socket.emit("unsubscribe", {
        channel: "candle",
        ...candleSubscription,
      });
      socket.close();
    };
  }, [apiBaseUrl, interval, provider, symbol]);

  useEffect(() => {
    let active = true;

    const refreshLiveData = async (): Promise<void> => {
      const [latestCandles, latestTicker] = await Promise.all([
        fetchJson<RawCandle[]>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/exchanges/${provider}/klines/${symbol}?interval=${interval}&limit=2`,
          ),
        ).catch(() =>
          fetchJson<RawCandle[]>(
            resolveMarketUrl(
              apiBaseUrl,
              `/api/market/candles/${provider}/${symbol}?interval=${interval}&limit=2`,
            ),
          ).catch(() => []),
        ),
        fetchJson<TickerData>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/exchanges/${provider}/ticker/${symbol}`,
          ),
        ).catch(() =>
          fetchJson<TickerData>(
            resolveMarketUrl(
              apiBaseUrl,
              `/api/market/tickers/${provider}/${symbol}`,
            ),
          ).catch(() => null),
        ),
      ]);
      if (!active) return;
      const latest = latestCandles.at(-1);
      if (latest) {
        setRealtimeCandle(toChartCandle(latest));
        setLastRealtimeAt(new Date());
      }
      if (latestTicker) setTicker(latestTicker);
    };

    void refreshLiveData();
    const timer = window.setInterval(() => void refreshLiveData(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBaseUrl, interval, provider, symbol]);

  useEffect(() => {
    let active = true;

    const refreshMetadata = async (): Promise<void> => {
      const [status, fundingRate, interest, snapshot] = await Promise.all([
        fetchJson<StreamStatus>(
          resolveMarketUrl(apiBaseUrl, `/api/market/status/${provider}`),
        ).catch(() => null),
        fetchJson<FundingRate>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/exchanges/${provider}/funding-rate/${symbol}`,
          ),
        ).catch(() => null),
        fetchJson<OpenInterest>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/exchanges/${provider}/open-interest/${symbol}`,
          ),
        ).catch(() => null),
        fetchJson<IndicatorSnapshot>(
          resolveMarketUrl(
            apiBaseUrl,
            `/api/market/indicators/${provider}/${symbol}?interval=${interval}`,
          ),
        ).catch(() => null),
      ]);
      if (!active) return;
      setStreamStatus(status);
      setFunding(fundingRate);
      setOpenInterest(interest);
      if (snapshot) setIndicators(snapshot);
    };

    void refreshMetadata();
    const timer = window.setInterval(() => void refreshMetadata(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBaseUrl, interval, provider, symbol]);

  const providerMessageAge = streamStatus?.lastMessageAt
    ? now - new Date(streamStatus.lastMessageAt).getTime()
    : Number.POSITIVE_INFINITY;
  const providerState = streamStatus?.state ?? "UNKNOWN";
  const streamIsHealthy = providerState === "CONNECTED";
  const isStale =
    ["STALE", "DEGRADED", "DISCONNECTED", "FAILED"].includes(providerState) ||
    (streamStatus?.lastMessageAt !== undefined &&
      providerMessageAge > STALE_AFTER_MS);
  const isLive = socketConnected && streamIsHealthy && !isStale;

  const priceColor = useMemo(() => {
    const lastClose = historicalData.at(-1)?.close;
    if (lastClose === undefined || !ticker) return "text-white";
    return Number(ticker.lastPrice) >= Number(lastClose)
      ? "text-emerald-400"
      : "text-rose-400";
  }, [historicalData, ticker]);

  return (
    <div className="space-y-5 text-white">
      <section className="rounded-2xl border border-[#2B2B43] bg-[#131722] p-5 shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
              Realtime market
            </p>
            <h1 className="mt-2 text-3xl font-bold">{symbol}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-400">
              <span className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isLive ? "animate-pulse bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                {isLive
                  ? "Live stream"
                  : `${providerState.toLowerCase()} stream`}
              </span>
              <span>
                Socket: {socketConnected ? "connected" : "reconnecting"}
              </span>
              <span>
                Messages:{" "}
                {formatNumber(String(streamStatus?.messageCount ?? 0), 0)}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Exchange
              <select
                aria-label="Exchange"
                className="mt-1 block w-full rounded-lg border border-[#36364f] bg-[#0B0E14] px-3 py-2 text-sm text-white"
                onChange={(event) =>
                  setProvider(event.target.value as MarketProvider)
                }
                value={provider}
              >
                {PROVIDERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Pair
              <select
                aria-label="Trading pair"
                className="mt-1 block w-full rounded-lg border border-[#36364f] bg-[#0B0E14] px-3 py-2 text-sm text-white"
                onChange={(event) => setSymbol(event.target.value)}
                value={symbol}
              >
                {(dynamicSymbols.length > 0 ? dynamicSymbols : SYMBOLS).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Timeframe
              <select
                aria-label="Timeframe"
                className="mt-1 block w-full rounded-lg border border-[#36364f] bg-[#0B0E14] px-3 py-2 text-sm text-white"
                onChange={(event) => setIntervalValue(event.target.value)}
                value={interval}
              >
                {INTERVALS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {isStale && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Market stream is stale</p>
            <p className="mt-1 text-amber-100/70">
              Realtime events are delayed. The chart is temporarily using the
              five-second REST refresh fallback.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          {error.includes("451") || error.includes("Binance") ? (
            <button
              className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400"
              onClick={() => {
                setProvider("OKX_FUTURES");
                setError(null);
              }}
              type="button"
            >
              Switch to OKX Futures
            </button>
          ) : null}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Radio className="h-4 w-4" />}
          label="Last price"
          value={formatNumber(ticker?.lastPrice)}
          valueClassName={priceColor}
        />
        <MetricCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="24h volume"
          value={formatNumber(ticker?.volume24h)}
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Funding rate"
          value={
            funding
              ? `${formatNumber(String(Number(funding.fundingRate) * 100), 6)}%`
              : "—"
          }
          detail={
            funding?.nextFundingTime
              ? `Next ${new Date(funding.nextFundingTime).toLocaleTimeString()}`
              : undefined
          }
        />
        <MetricCard
          icon={<Database className="h-4 w-4" />}
          label="Open interest"
          value={formatNumber(openInterest?.openInterest, 3)}
          detail={
            openInterest?.openInterestValue
              ? `$${formatNumber(openInterest.openInterestValue)}`
              : undefined
          }
        />
      </section>

      <section className="relative min-h-[500px] overflow-hidden rounded-2xl border border-[#2B2B43] bg-[#131722]">
        {isLoading ? (
          <div className="flex h-[500px] flex-col items-center justify-center gap-4 text-blue-400">
            <Loader2 className="h-10 w-10 animate-spin" />
            <p className="text-sm text-gray-400">Loading market history…</p>
          </div>
        ) : historicalData.length === 0 ? (
          <div className="flex h-[500px] items-center justify-center text-sm text-gray-400">
            No candle history is available for this selection.
          </div>
        ) : (
          <TradingChart
            data={historicalData}
            interval={interval}
            realtimeUpdate={realtimeCandle}
            symbol={symbol}
          />
        )}
        {lastRealtimeAt && (
          <span className="absolute bottom-3 left-4 z-10 rounded bg-black/60 px-2 py-1 text-[11px] text-gray-300">
            Updated {lastRealtimeAt.toLocaleTimeString()}
          </span>
        )}
      </section>

      <section className="rounded-2xl border border-[#2B2B43] bg-[#131722] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
              Technical indicators
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {symbol} · {interval}
            </h2>
          </div>
          <span className="text-xs text-gray-500">Closed-candle values</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Indicator label="SMA 20" value={indicators?.values.sma20} />
          <Indicator label="EMA 20" value={indicators?.values.ema20} />
          <Indicator label="RSI 14" value={indicators?.values.rsi14} />
          <Indicator label="MACD" value={indicators?.values.macd?.value} />
          <Indicator label="ATR 14" value={indicators?.values.atr14} />
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  valueClassName = "text-white",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-[#2B2B43] bg-[#131722] p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400">
        {icon}
        {label}
      </div>
      <p className={`mt-3 text-xl font-semibold ${valueClassName}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
    </div>
  );
}

function Indicator({
  label,
  value,
}: {
  label: string;
  value?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-[#0B0E14] p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-sm text-gray-100">
        {formatNumber(value, 4)}
      </p>
    </div>
  );
}
