"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primary = [
  ["Overview", "/"],
  ["Market", "/market"],
  ["Decision", "/ai/decision"],
  ["Automation", "/ai/pipeline"],
  ["Trading", "/ai/live-trading"],
] as const;

const more = [
  ["News", "/news"],
  ["Macro", "/macro"],
  ["Sentiment", "/sentiment"],
  ["Agent runs", "/ai/agent-runs"],
  ["Performance", "/ai/performance"],
  ["Risk", "/ai/risk"],
  ["Portfolio", "/ai/portfolio"],
] as const;

export function AppNavigation(): React.JSX.Element {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === href : pathname.startsWith(href);
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-full items-center gap-1 overflow-x-auto pb-1 text-sm lg:w-auto lg:overflow-visible lg:pb-0"
    >
      {primary.map(([label, href]) => (
        <Link
          className={`whitespace-nowrap rounded-lg px-3 py-2 transition-colors ${active(href) ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          href={href}
          key={href}
        >
          {label}
        </Link>
      ))}
      <details className="group relative shrink-0">
        <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          Insights
        </summary>
        <div className="absolute right-0 z-50 mt-2 grid w-52 gap-1 rounded-xl border bg-card p-2 shadow-2xl">
          {more.map(([label, href]) => (
            <Link
              className={`rounded-lg px-3 py-2 ${active(href) ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </div>
      </details>
      <Link
        aria-label="Settings"
        className={`whitespace-nowrap rounded-lg px-3 py-2 ${pathname.startsWith("/settings") || pathname === "/profile" || pathname === "/security" || pathname === "/api-keys" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        href="/settings"
      >
        Settings
      </Link>
    </nav>
  );
}
