"use client";

import { exchangeConnectionSchema } from "@platform/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, ServerCog } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { AccountNav } from "@/components/account-nav";
import { apiRequestValidated } from "@/lib/api-client";

export default function ExchangesPage(): React.JSX.Element {
  const connections = useQuery({
    queryKey: ["exchange-connections"],
    queryFn: () =>
      apiRequestValidated(
        "/exchange-connections",
        z.array(exchangeConnectionSchema),
      ),
    retry: false,
  });
  return (
    <section>
      <AccountNav />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Exchange connections</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Private futures accounts connected with encrypted credentials.
          </p>
        </div>
        <Link
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          href="/settings/exchanges/new"
        >
          <Plus className="h-4 w-4" /> New connection
        </Link>
      </div>
      <div className="mt-8 divide-y divide-border border-y border-border">
        {connections.isLoading && (
          <p className="py-8 text-sm text-muted-foreground">
            Loading connections...
          </p>
        )}
        {connections.error && (
          <p className="py-8 text-sm text-red-300">
            {connections.error.message}
          </p>
        )}
        {connections.data?.length === 0 && (
          <div className="flex items-center gap-4 py-10 text-muted-foreground">
            <ServerCog className="h-8 w-8" />
            <p className="text-sm">No exchange connections are configured.</p>
          </div>
        )}
        {connections.data?.map((connection) => (
          <Link
            className="grid gap-3 py-5 hover:bg-muted/20 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-3"
            href={`/settings/exchanges/${connection.id}`}
            key={connection.id}
          >
            <div>
              <p className="font-medium">
                {connection.displayName ??
                  connection.provider.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {connection.environment} · {connection.maskedApiKey}
              </p>
            </div>
            <div className="text-xs">
              <span
                className={
                  connection.isVerified ? "text-emerald-300" : "text-amber-300"
                }
              >
                {connection.isVerified ? "Verified" : "Not verified"}
              </span>
              <span className="mx-2 text-border">|</span>
              <span
                className={
                  connection.isEnabled
                    ? "text-foreground"
                    : "text-muted-foreground"
                }
              >
                {connection.isEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}
