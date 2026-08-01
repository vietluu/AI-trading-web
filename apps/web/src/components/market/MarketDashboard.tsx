"use client";

import React, { useEffect, useState, useMemo } from "react";
import io from "socket.io-client";
import { TradingChart } from "./TradingChart";
import type { CandlestickData, Time } from "lightweight-charts";
import { Loader2 } from "lucide-react";

interface TickerData {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  volume24h: string;
  high24h: string;
  low24h: string;
}

interface RawCandle {
  openTime: string | number | Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
}

interface SocketCandleEvent extends RawCandle {
  symbol: string;
  interval: string;
}

interface MarketDashboardProps {
  apiBaseUrl: string;
  defaultSymbol?: string;
  defaultInterval?: string;
}

export function MarketDashboard({
  apiBaseUrl,
  defaultSymbol = "BTC-USDT",
  defaultInterval = "1h",
}: MarketDashboardProps) {
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [historicalData, setHistoricalData] = useState<CandlestickData[]>([]);
  const [realtimeCandle, setRealtimeCandle] = useState<CandlestickData | undefined>();
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [symbol] = useState(defaultSymbol);

  // Fetch historical candles initially
  useEffect(() => {
    async function fetchHistoricalData() {
      setIsLoading(true);
      try {
        const res = await fetch(
          `${apiBaseUrl}/api/market/candles/BINANCE_FUTURES/${symbol}?interval=${defaultInterval}&limit=500`
        );
        if (!res.ok) throw new Error("Failed to fetch historical data");
        const data = (await res.json()) as RawCandle[];
        
        const formattedData: CandlestickData[] = data.map((d: RawCandle) => ({
          time: (new Date(d.openTime).getTime() / 1000) as Time,
          open: Number(d.open),
          high: Number(d.high),
          low: Number(d.low),
          close: Number(d.close),
        }));
        setHistoricalData(formattedData);
      } catch (error) {
        console.error("Error fetching historical data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    void fetchHistoricalData();
  }, [symbol, defaultInterval, apiBaseUrl]);

  // Handle WebSocket connection
  useEffect(() => {
    const wsUrl = apiBaseUrl.replace(/^http/, 'ws');
    const newSocket = io(`${wsUrl}/market`, {
      path: "/socket.io/",
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    newSocket.on("connect", () => {
      setIsConnected(true);
      // Subscribe to streams
      newSocket.emit("subscribe", { channel: "ticker", symbol });
      newSocket.emit("subscribe", { channel: "candle", symbol, interval: defaultInterval });
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    newSocket.on("ticker", (data: TickerData) => {
      if (data.symbol === symbol) {
        setTicker(data);
      }
    });

    newSocket.on("candle", (data: SocketCandleEvent) => {
      if (data.symbol === symbol && data.interval === defaultInterval) {
        setRealtimeCandle({
          time: (new Date(data.openTime).getTime() / 1000) as Time,
          open: Number(data.open),
          high: Number(data.high),
          low: Number(data.low),
          close: Number(data.close),
        });
      }
    });

    return () => {
      newSocket.emit("unsubscribe", { channel: "ticker", symbol });
      newSocket.emit("unsubscribe", { channel: "candle", symbol, interval: defaultInterval });
      newSocket.close();
    };
  }, [symbol, defaultInterval, apiBaseUrl]);

  const priceColor = useMemo(() => {
    if (!historicalData.length || !ticker) return "text-white";
    const lastClose = historicalData[historicalData.length - 1]!.close;
    const currentPrice = parseFloat(ticker.lastPrice);
    return currentPrice >= Number(lastClose) ? "text-[#26a69a]" : "text-[#ef5350]";
  }, [ticker, historicalData]);

  return (
    <div className="min-h-screen bg-[#0B0E14] text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center p-6 bg-[#131722] border border-[#2B2B43] rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.4)] backdrop-blur-md">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
              {symbol}
            </h1>
            <div className="flex items-center space-x-3 text-sm">
              <div className="flex items-center space-x-1">
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-gray-400 font-medium">{isConnected ? 'Live Stream' : 'Connecting...'}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 md:mt-0 flex gap-6">
            <div className="flex flex-col items-end">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Price</span>
              <span className={`text-2xl font-bold tracking-tight ${priceColor}`}>
                {ticker ? parseFloat(ticker.lastPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '---'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">24h Vol</span>
              <span className="text-xl font-semibold text-gray-200">
                {ticker ? parseFloat(ticker.volume24h).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '---'}
              </span>
            </div>
            <div className="flex flex-col items-end hidden sm:flex">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">24h High</span>
              <span className="text-xl font-semibold text-gray-200">
                {ticker ? parseFloat(ticker.high24h).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '---'}
              </span>
            </div>
          </div>
        </div>

        {/* Chart Section */}
        <div className="relative rounded-2xl overflow-hidden p-[1px] bg-gradient-to-b from-[#2B2B43] to-transparent">
          <div className="bg-[#131722] rounded-2xl p-1 relative min-h-[500px] flex items-center justify-center">
            {isLoading ? (
              <div className="flex flex-col items-center text-blue-500 space-y-4">
                <Loader2 className="w-10 h-10 animate-spin" />
                <p className="text-gray-400 font-medium">Loading market data...</p>
              </div>
            ) : (
              <div className="w-full h-full animate-in fade-in duration-500">
                <TradingChart
                  data={historicalData}
                  symbol={symbol}
                  interval={defaultInterval}
                  realtimeUpdate={realtimeCandle}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
