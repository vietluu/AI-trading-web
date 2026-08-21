"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { publicEnvironment } from "@/lib/environment";
import {
  useLiveTradingActions,
  useLiveTradingDashboard,
} from "@/hooks/ai/useAiFeature";
import type { LiveTradingDashboard } from "@/services/ai-feature.service";
import { calculateLiveTradingTotals } from "@/lib/live-trading-metrics";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const RECENT_TRADE_HISTORY_LIMIT = 20;

export default function LiveTradingPage(): React.JSX.Element {
  const { t } = useTranslation();
  const query = useLiveTradingDashboard();
  const [liveData, setLiveData] = useState<LiveTradingDashboard | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const { killMutation, enableMutation } =
    useLiveTradingActions();
  const kill = killMutation;
  const enable = enableMutation;
  const queryDataRef = useRef(query.data);
  queryDataRef.current = query.data;

  useEffect(() => {
    if (query.data) {
      setLiveData(query.data);
    }
  }, [query.data]);

  // Connect sockets strictly AFTER initial API call succeeds to prevent overlap/blocking
  useEffect(() => {
    if (!query.isSuccess) return;

    const rawApiUrl = publicEnvironment.NEXT_PUBLIC_API_BASE_URL.trim();
    const baseUrl = rawApiUrl
      ? rawApiUrl.replace(/\/$/, "")
      : typeof window !== "undefined"
        ? window.location.port === "3000"
          ? `${window.location.protocol}//${window.location.hostname}:3001`
          : window.location.origin
        : "";

    // 1. Dashboard snapshot socket
    const socket = io(`${baseUrl}/live-trading`, {
      path:
        typeof window !== "undefined"
          ? (window as Window & { __SOCKET_IO_PATH__?: string }).__SOCKET_IO_PATH__ ?? "/socket.io/"
          : "/socket.io/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: true,
    });

    socket.on("connect", () => {
      socket.emit("subscribe", {});
    });

    socket.on("snapshot", (payload: LiveTradingDashboard) => {
      setLiveData(payload);
    });

    // 2. Real-time market ticker socket
    const marketSocket = io(`${baseUrl}/market`, {
      path:
        typeof window !== "undefined"
          ? (window as Window & { __SOCKET_IO_PATH__?: string }).__SOCKET_IO_PATH__ ?? "/socket.io/"
          : "/socket.io/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const subscribePositions = (positions: LiveTradingDashboard["positions"], connections: LiveTradingDashboard["connections"]) => {
      for (const pos of positions) {
        const provider =
          pos.provider ??
          connections.find((c) => c.id === pos.connectionId)?.provider ??
          "OKX_FUTURES";
        marketSocket.emit("subscribe", {
          channel: "ticker",
          provider,
          symbol: pos.symbol,
        });
      }
    };

    marketSocket.on("connect", () => {
      const initialPositions = queryDataRef.current?.positions ?? [];
      const initialConnections = queryDataRef.current?.connections ?? [];
      subscribePositions(initialPositions, initialConnections);
    });

    marketSocket.on("ticker", (ticker: { symbol: string; lastPrice?: string; markPrice?: string }) => {
      const price = Number(ticker.lastPrice ?? ticker.markPrice ?? 0);
      if (price > 0 && ticker.symbol) {
        setLivePrices((prev) => ({ ...prev, [ticker.symbol]: price }));
      }
    });

    return () => {
      socket.disconnect();
      marketSocket.disconnect();
    };
  }, [query.isSuccess]);

  if (query.isLoading && !liveData)
    return <p className="text-muted-foreground">{t.ai.loadingStatus}…</p>;
  if (query.isError)
    return (
      <p className="text-red-400" role="alert">
        {query.error.message}
      </p>
    );
  const data = liveData ?? query.data;
  if (!data)
    return <p className="text-muted-foreground">{t.ai.configureConnection}</p>;

  // Exchange-native UPL is authoritative for contract size and mark-price rules.
  const totals = calculateLiveTradingTotals(data.accounts, data.positions);

  const openOrders = data.orders.filter((order) =>
    ["SUBMITTING", "NEW", "PARTIALLY_FILLED"].includes(order.status),
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t.ai.liveTradingTitle}</h1>
          <p className="mt-1 text-muted-foreground">
            {t.ai.liveTradingSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${data.mode === "LIVE" ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"}`}
          >
            {data.mode}
          </span>
          {data.globalTradingEnabled ? (
            <button
              className="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-50"
              disabled={kill.isPending}
              onClick={() => kill.mutate()}
            >
              {kill.isPending ? t.ai.stopping : t.ai.killSwitch}
            </button>
          ) : (
            <button
              className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
              disabled={enable.isPending}
              onClick={() => enable.mutate()}
            >
              {enable.isPending ? t.ai.enabling : t.ai.enableTrading}
            </button>
          )}
        </div>
      </div>
      {!data.globalTradingEnabled && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          {t.ai.globalTradingDisabled}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t.ai.equity, money.format(totals.equity)],
          [t.ai.available, money.format(totals.available)],
          [t.ai.unrealizedPnl, money.format(totals.pnl)],
          [t.ai.openOrders, String(openOrders.length)],
        ].map(([label, value]) => (
          <div className="rounded-lg border bg-card p-5" key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <Table
        title={t.ai.positions}
        headings={[
          t.ai.symbol,
          "Side",
          "Size",
          "Entry / Mark",
          "Leverage",
          "PnL (ROI %)",
          "Liquidation",
        ]}
        empty={t.ai.noPositions}
      >
        {data.positions.map((position) => {
          const livePrice =
            livePrices[position.symbol] ??
            (position.markPrice ? Number(position.markPrice) : position.entryPrice);
          const positionUpl = position.unrealizedPnl;
          const notional = Math.abs(
            position.notional ?? position.entryPrice * position.quantity,
          );
          const leverage = position.leverage && position.leverage > 0 ? position.leverage : 1;
          const margin = notional / leverage;
          const roiPct = margin > 0 ? (positionUpl / margin) * 100 : 0;
          return (
            <tr key={position.id}>
              <td className="p-3 font-semibold">{position.symbol}</td>
              <td
                className={`p-3 font-semibold ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}
              >
                {position.side}
              </td>
              <td className="p-3 font-mono">
                <div>{position.quantity}</div>
                {notional > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    ≈ {money.format(notional)}
                  </div>
                )}
              </td>
              <td className="p-3 font-mono text-xs">
                {position.entryPrice} / {livePrice ? livePrice.toFixed(2) : "—"}
              </td>
              <td className="p-3">
                {position.leverage ? `${position.leverage}×` : "—"}
              </td>
              <td
                className={`p-3 font-mono font-semibold ${positionUpl >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                <div>
                  {positionUpl > 0 ? "+" : ""}
                  {money.format(positionUpl)}
                </div>
                {margin > 0 && (
                  <div className="text-xs font-normal opacity-85">
                    ({positionUpl >= 0 ? "+" : ""}
                    {roiPct.toFixed(2)}%)
                  </div>
                )}
              </td>
              <td className="p-3 font-mono text-xs">
                {position.liquidationPrice ?? "—"}
              </td>
            </tr>
          );
        })}
      </Table>
      <Table
        title={t.ai.openOrdersTable}
        headings={["Order", t.ai.symbol, "Side", "Size", "Price", "Status", t.ai.realizedPnl]}
        empty={t.ai.noOpenOrders}
      >
        {openOrders.map((order) => (
          <OrderRow order={order} key={order.id} showPnl />
        ))}
      </Table>
      <Table
        title={t.ai.tradeHistory}
        headings={["Order", t.ai.symbol, "Side", "Size", "Price", "Status", t.ai.realizedPnl]}
        empty={t.ai.noTradeHistory}
      >
        {data.orders.slice(0, RECENT_TRADE_HISTORY_LIMIT).map((order) => (
          <OrderRow order={order} key={order.id} showPnl />
        ))}
      </Table>
      {(killMutation.error || enableMutation.error) && (
        <p className="text-sm text-red-400" role="alert">
          {
            (killMutation.error ?? enableMutation.error)
              ?.message
          }
        </p>
      )}
    </div>
  );
}

function Table({
  title,
  headings,
  empty,
  children,
}: {
  title: string;
  headings: string[];
  empty: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const hasRows = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              {headings.map((heading) => (
                <th className="p-3" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">{children}</tbody>
        </table>
        {!hasRows && (
          <p className="p-8 text-center text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  );
}

function OrderRow({
  order,
  showPnl = false,
}: {
  order: LiveTradingDashboard["orders"][number];
  showPnl?: boolean;
}): React.JSX.Element {
  return (
    <tr>
      <td className="p-3 font-mono text-xs">
        {order.orderId ?? order.clientOrderId}
        <div className="text-muted-foreground">{order.purpose}</div>
      </td>
      <td className="p-3 font-semibold">{order.symbol}</td>
      <td
        className={
          order.side === "BUY" ? "p-3 text-emerald-400" : "p-3 text-red-400"
        }
      >
        {order.side}
      </td>
      <td className="p-3 font-mono">{order.size}</td>
      <td className="p-3 font-mono">{order.price ?? "market"}</td>
      <td className="p-3">
        {order.status}
        {order.errorCode && (
          <div className="text-xs text-red-400">{order.errorCode}</div>
        )}
      </td>
      {showPnl && (
        <td
          className={`p-3 font-mono font-semibold ${
            order.netPnl === null
              ? "text-muted-foreground"
              : order.netPnl >= 0
                ? "text-emerald-400"
                : "text-red-400"
          }`}
          title={
            order.netPnl === null
              ? undefined
              : `Gross: ${money.format(order.grossPnl ?? 0)} · Fee: ${money.format(order.fee ?? 0)}`
          }
        >
          {order.netPnl === null ? (
            "—"
          ) : (
            <div>
              <div>
                {order.netPnl > 0 ? "+" : ""}
                {money.format(order.netPnl)}
              </div>
              {order.returnPct !== null && (
                <div className="text-xs font-normal opacity-85">
                  ({order.returnPct >= 0 ? "+" : ""}
                  {order.returnPct.toFixed(2)}%)
                </div>
              )}
              {order.fee !== null && order.fee > 0 && (
                <div className="text-[10px] font-normal text-muted-foreground">
                  Fee: {money.format(order.fee)}
                </div>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
