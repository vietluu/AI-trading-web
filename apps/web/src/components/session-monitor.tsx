"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { apiRequest } from "@/lib/api-client";

const publicPaths = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

export function SessionMonitor(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (publicPaths.includes(pathname)) return;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const logout = (): void => {
      const next = encodeURIComponent(
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.assign(`/login?reason=session-expired&next=${next}`);
    };
    const check = async (): Promise<void> => {
      try {
        const session = await apiRequest<{ expiresAt: string }>(
          "/auth/session",
        );
        if (stopped) return;
        const remaining = new Date(session.expiresAt).getTime() - Date.now();
        if (remaining <= 0) return logout();

        // Silent Refresh: If less than 5 minutes remain and session is active, refresh the session
        if (remaining <= 300_000) {
          try {
            await apiRequest("/auth/refresh", { method: "POST" });
            const refreshed = await apiRequest<{ expiresAt: string }>("/auth/session");
            if (!stopped) {
              const newRemaining = new Date(refreshed.expiresAt).getTime() - Date.now();
              clearTimeout(expiryTimer);
              expiryTimer = setTimeout(logout, Math.min(newRemaining, 2_147_000_000));
            }
            return;
          } catch {
            // If refresh fails, let standard expiryTimer handle logout
          }
        }

        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(logout, Math.min(remaining, 2_147_000_000));
      } catch {
        // apiRequest emits auth:expired for an invalid server-side session.
      }
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };

    window.addEventListener("auth:expired", logout);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(expiryTimer);
      window.removeEventListener("auth:expired", logout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname]);

  return null;
}
