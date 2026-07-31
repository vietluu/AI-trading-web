"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { apiRequest } from "@/lib/api-client";

const publicPaths = [
  "/",
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
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(logout, Math.min(remaining, 2_147_000_000));
      } catch {
        // apiRequest emits auth:expired for an invalid server-side session.
      }
    };
    window.addEventListener("auth:expired", logout);
    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(expiryTimer);
      window.removeEventListener("auth:expired", logout);
    };
  }, [pathname]);

  return null;
}
