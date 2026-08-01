import React from "react";
import { MarketDashboard } from "@/components/market/MarketDashboard";

export const metadata = {
  title: "Live Market Data | AI Trading Platform",
  description: "Real-time cryptocurrency market data, charts, and analysis.",
};

export default function MarketPage() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

  return (
    <main className="min-h-screen bg-[#0B0E14]">
      <MarketDashboard 
        apiBaseUrl={apiBaseUrl} 
        defaultSymbol="BTC-USDT" 
        defaultInterval="1h" 
      />
    </main>
  );
}
