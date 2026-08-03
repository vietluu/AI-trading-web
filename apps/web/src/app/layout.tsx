import type { Metadata } from "next";
import Link from "next/link";
import type { PropsWithChildren } from "react";

import { QueryProvider } from "@/components/query-provider";
import { SessionMonitor } from "@/components/session-monitor";
import { AppNavigation } from "@/components/app-navigation";

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
      <body className="overflow-x-hidden antialiased">
        <QueryProvider>
          <SessionMonitor />
          <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 sm:px-6 lg:px-8">
            <header className="relative flex min-h-16 items-center justify-between border-b border-border py-4">
              <Link className="flex items-center gap-3 shrink-0" href="/">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground">
                  AX
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">AI Trading Research</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Multi-agent futures intelligence
                  </p>
                </div>
              </Link>
              <AppNavigation />
            </header>
            <main className="min-w-0 flex-1 py-6 sm:py-8">{children}</main>
            <footer className="border-t border-border py-6 text-xs text-muted-foreground">
              Phase 4 · Realtime market-data research
            </footer>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
