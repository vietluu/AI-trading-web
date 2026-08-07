"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { publicEnvironment } from "@/lib/environment";
import {
  useLiveTradingActions,
  useLiveTradingDashboard,
} from "@/hooks/ai/useAiFeature";

interface Dashboard {
  mode: string;
  globalTradingEnabled: boolean;
  liveTradingEnabled: boolean;
  connections: Array<{
    id: string;
    provider: string;
    environment: string;
    displayName: string | null;
    isEnabled: boolean;
    isVerified: boolean;
  }>;
  accounts: Array<{
    connectionId: string;
    totalEquity: number;
    availableBalance: number;
    unrealizedPnl: number;
    marginBalance: number;
    syncedAt: string;
  }>;
  positions: Array<{
    id: string;
    connectionId: string;
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    markPrice: number | null;
    liquidationPrice: number | null;
    leverage: number | null;
    unrealizedPnl: number;
    syncedAt: string;
  }>;
  orders: Array<{
    id: string;
    orderId: string | null;
    clientOrderId: string;
    provider: string;
    environment: string;
    symbol: string;
    side: string;
    size: number;
    price: number | null;
    status: string;
    purpose: string;
    errorCode: string | null;
    createdAt: string;
  }>;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export default function LiveTradingPage(): React.JSX.Element {
  const { t } = useTranslation();
  const query = useLiveTradingDashboard();
  const [liveData, setLiveData] = useState<Dashboard | null>(null);
  const {killMutation, enableMutation } =
    useLiveTradingActions();
  const kill = killMutation;
  const enable = enableMutation;
  useEffect(() => {
    if (query.data) {
      setLiveData(query.data);
    }
  }, [query.data]);

  useEffect(() => {
    const rawApiUrl = publicEnvironment.NEXT_PUBLIC_API_BASE_URL.trim();
    const baseUrl = rawApiUrl
      ? rawApiUrl.replace(/\/$/, "")
      : typeof window !== "undefined"
        ? window.location.port === "3000"
          ? `${window.location.protocol}//${window.location.hostname}:3001`
          : window.location.origin
        : "";

    const socket = io(`${baseUrl}/live-trading`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
      withCredentials: true,
    });

    socket.on("connect", () => {
      socket.emit("subscribe", {});
    });

    socket.on("snapshot", (payload: Dashboard) => {
      setLiveData(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  if (query.isLoading)
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
  const totals = data.accounts.reduce(
    (value, account) => ({
      equity: value.equity + account.totalEquity,
      available: value.available + account.availableBalance,
      pnl: value.pnl + account.unrealizedPnl,
    }),
    { equity: 0, available: 0, pnl: 0 },
  );
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
          "PnL",
          "Liquidation",
        ]}
        empty={t.ai.noPositions}
      >
        {data.positions.map((position) => (
          <tr key={position.id}>
            <td className="p-3 font-semibold">{position.symbol}</td>
            <td
              className={`p-3 ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}
            >
              {position.side}
            </td>
            <td className="p-3 font-mono">{position.quantity}</td>
            <td className="p-3 font-mono text-xs">
              {position.entryPrice} / {position.markPrice ?? "—"}
            </td>
            <td className="p-3">
              {position.leverage ? `${position.leverage}×` : "—"}
            </td>
            <td
              className={`p-3 ${position.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {money.format(position.unrealizedPnl)}
            </td>
            <td className="p-3 font-mono text-xs">
              {position.liquidationPrice ?? "—"}
            </td>
          </tr>
        ))}
      </Table>
      <Table
        title={t.ai.openOrdersTable}
        headings={["Order", t.ai.symbol, "Side", "Size", "Price", "Status"]}
        empty={t.ai.noOpenOrders}
      >
        {openOrders.map((order) => (
          <OrderRow order={order} key={order.id} />
        ))}
      </Table>
      <Table
        title={t.ai.tradeHistory}
        headings={["Order", t.ai.symbol, "Side", "Size", "Price", "Status"]}
        empty={t.ai.noTradeHistory}
      >
        {data.orders.map((order) => (
          <OrderRow order={order} key={order.id} />
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
}: {
  order: Dashboard["orders"][number];
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
    </tr>
  );
}
