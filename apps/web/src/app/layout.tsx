import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import type { PropsWithChildren } from "react";

import { QueryProvider } from "@/components/query-provider";
import { SessionMonitor } from "@/components/session-monitor";
import { AppNavigation } from "@/components/app-navigation";
import { PwaRegistration } from "@/components/pwa-registration";
import { LanguageProvider } from "@/lib/i18n/i18n-context";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "AI Trading Research",
  title: {
    default: "AI Trading Research",
    template: "%s | AI Trading Research",
  },
  description:
    "Multi-agent cryptocurrency futures research and trading platform.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.jpg",
    apple: "/apple-icon.jpg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Trading Research",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#07111f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: PropsWithChildren): React.JSX.Element {
  return (
    <html lang="en">
      <body className="overflow-x-hidden antialiased">
        <PwaRegistration />
        <LanguageProvider>
          <QueryProvider>
            <SessionMonitor />
            <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 sm:px-6 lg:px-8">
              <header className="relative flex min-h-16 items-center justify-between border-b border-border py-4">
                <Link className="flex items-center gap-3 shrink-0" href="/">
                  <Image
                    alt="AI Trading Logo"
                    className="h-9 w-9 rounded-xl object-cover shadow-sm ring-1 ring-primary/30"
                    height={36}
                    src="/icon.jpg"
                    width={36}
                  />
                  <div>
                    <p className="text-sm font-semibold leading-none">
                      AI Trading Research
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Multi-agent futures intelligence
                    </p>
                  </div>
                </Link>
                <AppNavigation />
              </header>
              <main className="min-w-0 flex-1 py-6 sm:py-8">{children}</main>
              <footer className="border-t border-border py-6 text-xs text-muted-foreground">
                Multi-agent trading intelligence · Risk-controlled execution
              </footer>
            </div>
          </QueryProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
