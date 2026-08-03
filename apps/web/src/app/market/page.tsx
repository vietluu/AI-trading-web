import React from "react";
import { MarketDashboard } from "@/components/market/MarketDashboard";

export const metadata = {
  title: "Live Market Data | AI Trading Platform",
  description: "Real-time cryptocurrency market data, charts, and analysis.",
};

export default function MarketPage() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

  return (
    <div className="rounded-3xl bg-[#0B0E14] p-3 sm:p-5">
      <MarketDashboard
        apiBaseUrl={apiBaseUrl}
        defaultSymbol="BTC-USDT"
        defaultInterval="1h"
      />
    </div>
  );
}
