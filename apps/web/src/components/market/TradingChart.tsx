"use client";

import React, { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
} from "lightweight-charts";

export interface TradingChartProps {
  data: CandlestickData[];
  symbol: string;
  interval: string;
  realtimeUpdate?: CandlestickData;
}

export function TradingChart({
  data,
  symbol,
  interval,
  realtimeUpdate,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#2B2B43" },
        horzLines: { color: "#2B2B43" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "#2B2B43",
      },
      timeScale: {
        borderColor: "#2B2B43",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    // Ensure data is sorted by time and formatted properly
    const formattedData = [...data].sort(
      (a, b) => (a.time as number) - (b.time as number),
    );
    series.setData(formattedData);

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    // Fit content on initial load
    chart.timeScale().fitContent();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data]);

  useEffect(() => {
    if (seriesRef.current && realtimeUpdate) {
      seriesRef.current.update(realtimeUpdate);
    }
  }, [realtimeUpdate]);

  return (
    <div className="relative w-full h-[500px] bg-[#131722] rounded-xl overflow-hidden border border-[#2B2B43] shadow-lg">
      <div className="absolute top-4 left-4 z-10 text-white font-semibold text-lg flex items-center space-x-2">
        <span className="bg-blue-600 px-2 py-1 rounded text-sm">{symbol}</span>
        <span className="text-gray-400 text-sm bg-[#2B2B43] px-2 py-1 rounded">
          {interval}
        </span>
      </div>
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
