"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { publicEnvironment } from "./environment";

export interface ExternalDataChannelSubscription {
  type: string;
  symbols?: string[];
  minimumImportance?: number;
}

export interface ExternalDataSocketEvent {
  channel: string;
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export function useExternalDataSocket(
  channels: ExternalDataChannelSubscription[],
  onEvent?: (event: string, data: Record<string, unknown>) => void,
) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ event: string; data: Record<string, unknown> } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const callbackRef = useRef(onEvent);
  const channelsSerialized = JSON.stringify(channels);
  const channelsSignatureRef = useRef<string | null>(null);

  callbackRef.current = onEvent;

  useEffect(() => {
    if (channelsSignatureRef.current === channelsSerialized) {
      return;
    }
    channelsSignatureRef.current = channelsSerialized;

    const rawApiUrl = publicEnvironment.NEXT_PUBLIC_API_BASE_URL.trim();
    const baseUrl = rawApiUrl
      ? rawApiUrl.replace(/\/$/, "")
      : typeof window !== "undefined"
      ? (window.location.port === "3000"
          ? `${window.location.protocol}//${window.location.hostname}:3001`
          : window.location.origin)
      : "";

    const socket = io(`${baseUrl}/external-data`, {
      path: "/api/socket.io/",
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 3_000,
      timeout: 3_000,
      forceNew: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      const parsedChannels = JSON.parse(channelsSerialized) as ExternalDataChannelSubscription[];
      socket.emit("subscribe", { channels: parsedChannels });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    const handleMessage = (msg: ExternalDataSocketEvent) => {
      if (msg?.event && msg?.data) {
        setLastEvent({ event: msg.event, data: msg.data });
        if (callbackRef.current) {
          callbackRef.current(msg.event, msg.data);
        }
      }
    };

    socket.on("NEWS_ARTICLE_CREATED", handleMessage);
    socket.on("HIGH_IMPORTANCE_NEWS_DETECTED", handleMessage);
    socket.on("EXCHANGE_ANNOUNCEMENT_CREATED", handleMessage);
    socket.on("SECURITY_INCIDENT_CREATED", handleMessage);
    socket.on("SENTIMENT_INDEX_UPDATED", handleMessage);
    socket.on("MACRO_EVENT_CREATED", handleMessage);

    return () => {
      socket.disconnect();
    };
  }, [channelsSerialized]);

  return { isConnected, lastEvent };
}
