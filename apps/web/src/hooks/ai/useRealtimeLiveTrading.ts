"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { publicEnvironment } from "@/lib/environment";
import type { LiveTradingDashboard } from "@/services/ai-feature.service";
import { useLiveTradingDashboard } from "./useAiFeature";

export function applyLivePositionUpdate(
  current: LiveTradingDashboard,
  payload: {
    connectionId: string;
    positions: LiveTradingDashboard["positions"];
  },
): LiveTradingDashboard {
  const positions = [
    ...current.positions.filter(
      (position) => position.connectionId !== payload.connectionId,
    ),
    ...payload.positions,
  ];
  const connectionUpl = payload.positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );
  return {
    ...current,
    positions,
    accounts: current.accounts.map((account) =>
      account.connectionId === payload.connectionId
        ? { ...account, unrealizedPnl: connectionUpl }
        : account,
    ),
  };
}

export function useRealtimeLiveTradingDashboard(connectionId?: string) {
  const query = useLiveTradingDashboard();
  const [liveData, setLiveData] = useState<LiveTradingDashboard | null>(null);

  useEffect(() => {
    if (query.data) setLiveData(query.data);
  }, [query.data]);

  useEffect(() => {
    if (!query.isSuccess) return;
    const rawApiUrl = publicEnvironment.NEXT_PUBLIC_API_BASE_URL.trim();
    const baseUrl = rawApiUrl
      ? rawApiUrl.replace(/\/$/, "")
      : typeof window !== "undefined" && window.location.port === "3000"
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : typeof window !== "undefined"
          ? window.location.origin
          : "";
    const socket = io(`${baseUrl}/live-trading`, {
      path:
        typeof window !== "undefined"
          ? (window as Window & { __SOCKET_IO_PATH__?: string })
              .__SOCKET_IO_PATH__ ?? "/socket.io/"
          : "/socket.io/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      withCredentials: true,
    });
    socket.on("connect", () => {
      socket.emit("subscribe", connectionId ? { connectionId } : {});
    });
    socket.on("snapshot", (payload: LiveTradingDashboard) => {
      setLiveData(payload);
    });
    socket.on(
      "positions",
      (payload: {
        connectionId: string;
        positions: LiveTradingDashboard["positions"];
      }) => {
        setLiveData((current) =>
          current ? applyLivePositionUpdate(current, payload) : current,
        );
      },
    );
    return () => {
      socket.disconnect();
    };
  }, [connectionId, query.isSuccess]);

  return { ...query, data: liveData ?? query.data };
}
