"use client";

import { ArrowRight, Plus, Power, ServerCog } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AccountNav } from "@/components/account-nav";
import { Feedback } from "@/components/form-controls";
import { ROUTES } from "@/constants/routes";
import { useExchangeConnections } from "@/hooks/settings/useSettings";
import { reauthenticate } from "@/services/auth.service";

export default function ExchangesPage(): React.JSX.Element {
  const connections = useExchangeConnections();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function handleToggle(id: string, currentEnabled: boolean, environment: string) {
    setBusyId(id);
    setError(undefined);
    setMessage(undefined);
    try {
      if (!currentEnabled && environment === "PRODUCTION") {
        const password = window.prompt("Confirm your current password");
        if (!password) return;
        await reauthenticate(password);
      }
      const totpCode = window.prompt(
        "2FA code (leave blank when 2FA is not enabled)",
      );
      await connections.toggleMutation.mutateAsync({
        id,
        action: currentEnabled ? "disable" : "enable",
        totpCode: totpCode ?? undefined,
      });
      setMessage(
        currentEnabled
          ? "Exchange connection deactivated."
          : "Exchange connection activated as primary active exchange.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Activation failed");
    } finally {
      setBusyId(null);
    }
  }

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
          href={ROUTES.settingsExchanges + "/new"}
        >
          <Plus className="h-4 w-4" /> New connection
        </Link>
      </div>

      <div className="mt-4">
        <Feedback error={error} success={message} />
      </div>

      <div className="mt-6 divide-y divide-border border-y border-border">
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
          <div
            className="grid gap-3 py-5 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:px-3 hover:bg-muted/10 transition-colors"
            key={connection.id}
          >
            <Link
              className="group"
              href={ROUTES.settingsExchangeDetail(connection.id)}
            >
              <p className="font-medium group-hover:text-primary transition-colors">
                {connection.displayName ??
                  connection.provider.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {connection.environment} · {connection.maskedApiKey}
              </p>
            </Link>
            <div className="text-xs flex items-center gap-2">
              <span
                className={
                  connection.isVerified ? "text-emerald-300 font-medium" : "text-amber-300"
                }
              >
                {connection.isVerified ? "Verified" : "Not verified"}
              </span>
            </div>

            <button
              aria-label={
                connection.isEnabled ? "Deactivate exchange" : "Set active exchange"
              }
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                connection.isEnabled
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                  : "bg-muted text-muted-foreground border border-border hover:bg-muted/80 hover:text-foreground"
              }`}
              disabled={busyId === connection.id}
              onClick={() =>
                void handleToggle(
                  connection.id,
                  connection.isEnabled,
                  connection.environment,
                )
              }
              title={
                connection.isEnabled ? "Deactivate exchange" : "Set active exchange"
              }
            >
              <Power className={`h-3.5 w-3.5 ${connection.isEnabled ? "text-emerald-400" : "text-muted-foreground"}`} />
              <span>{connection.isEnabled ? "ACTIVE" : "Set Active"}</span>
            </button>

            <Link
              className="p-1 hover:text-primary transition-colors"
              href={ROUTES.settingsExchangeDetail(connection.id)}
              title="View detail"
            >
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
