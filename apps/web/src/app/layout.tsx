import type { Metadata } from "next";
import Link from "next/link";
import type { PropsWithChildren } from "react";

import { QueryProvider } from "@/components/query-provider";
import { SessionMonitor } from "@/components/session-monitor";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Trading Research",
    template: "%s | AI Trading Research",
  },
  description:
    "Multi-agent cryptocurrency futures research and trading platform.",
};

export default function RootLayout({
  children,
}: PropsWithChildren): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <SessionMonitor />
          <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 sm:px-8">
            <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-border py-4">
              <Link className="flex items-center gap-3" href="/">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground">
                  AX
                </div>
                <div>
                  <p className="text-sm font-semibold">AI Trading Research</p>
                  <p className="text-xs text-muted-foreground">
                    Multi-agent futures intelligence
                  </p>
                </div>
              </Link>
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                <Link className="rounded-lg px-3 py-2 hover:bg-muted" href="/">
                  Dashboard
                </Link>
                <Link
                  className="rounded-lg px-3 py-2 hover:bg-muted"
                  href="/market"
                >
                  Market
                </Link>
                <Link
                  className="rounded-lg px-3 py-2 hover:bg-muted"
                  href="/settings/exchanges"
                >
                  Exchanges
                </Link>
                <Link
                  className="rounded-lg px-3 py-2 hover:bg-muted"
                  href="/settings"
                >
                  Settings
                </Link>
                <Link
                  className="rounded-lg px-3 py-2 hover:bg-muted"
                  href="/profile"
                >
                  Account
                </Link>
                <span className="ml-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-200">
                  Live trading disabled
                </span>
              </nav>
            </header>
            <main className="flex-1 py-10">{children}</main>
            <footer className="border-t border-border py-6 text-xs text-muted-foreground">
              Phase 4 · Realtime market-data research
            </footer>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
