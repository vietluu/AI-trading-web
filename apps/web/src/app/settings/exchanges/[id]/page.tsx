"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { ROUTES } from "@/constants/routes";
import { useExchangeConnectionDetail } from "@/hooks/settings/useSettings";
import { reauthenticate } from "@/services/auth.service";

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export default function ExchangeDetailPage(): React.JSX.Element {
  const id = String(useParams<{ id: string }>().id);
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { connectionQuery, accountQuery, balancesQuery, positionsQuery, ordersQuery, toggleMutation, testMutation, updateMutation, replaceCredentialsMutation, deleteMutation } = useExchangeConnectionDetail(id);
  const connection = connectionQuery;
  const account = accountQuery;
  const balances = balancesQuery;
  const positions = positionsQuery;
  const orders = ordersQuery;
  const privateEnabled = Boolean(
    connection.data?.isEnabled && connection.data.isVerified,
  );

  async function mutate(path: string, success: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    const item = connection.data;
    try {
      if (path.endsWith("/enable") && item?.environment === "PRODUCTION") {
        const password = window.prompt("Confirm your current password");
        if (!password) return;
        await reauthenticate(password);
      }
      const totpCode = window.prompt(
        "2FA code (leave blank when 2FA is not enabled)",
      );
      await toggleMutation.mutateAsync({ action: path.endsWith("/enable") ? "enable" : "disable", totpCode: totpCode ?? undefined });
      setMessage(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await testMutation.mutateAsync();
      setMessage(
        result.success
          ? `Connection verified in ${result.latencyMs ?? 0} ms.`
          : (result.message ?? "Connection test failed"),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Connection test failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const totpCode = window.prompt(
        "2FA code (leave blank when 2FA is not enabled)",
      );
      await updateMutation.mutateAsync({ displayName: formString(form, "displayName") || null, totpCode: totpCode ?? undefined });
      setMessage("Connection name updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function replaceCredentials(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await reauthenticate(formString(form, "password"));
      await replaceCredentialsMutation.mutateAsync({
        payload: {
          apiKey: form.get("apiKey"),
          apiSecret: form.get("apiSecret"),
          passphrase:
            connection.data?.provider === "OKX_FUTURES"
              ? form.get("passphrase")
              : undefined,
        },
        totpCode: formString(form, "totpCode") || undefined,
      });
      formElement.reset();
      setMessage("Credentials replaced. Test the connection again.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Credential replacement failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm("Delete this connection and its encrypted credential?"))
      return;
    const password = window.prompt("Confirm your current password");
    if (!password) return;
    const totpCode = window.prompt(
      "2FA code (leave blank when 2FA is not enabled)",
    );
    setBusy(true);
    try {
      await reauthenticate(password);
      await deleteMutation.mutateAsync({ totpCode: totpCode ?? undefined });
      router.replace(ROUTES.settingsExchanges);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed");
      setBusy(false);
    }
  }

  if (connection.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Loading connection...</p>
    );
  if (!connection.data)
    return (
      <p className="text-sm text-red-300">
        {connection.error?.message ?? "Connection not found"}
      </p>
    );
  const item = connection.data;
  return (
    <section className="space-y-9">
      <div>
        <Link
          className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          href={ROUTES.settingsExchanges}
        >
          <ArrowLeft className="h-4 w-4" /> Connections
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">
              {item.displayName ?? item.provider.replaceAll("_", " ")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {item.environment} · {item.maskedApiKey} ·{" "}
              {item.isEnabled ? "Enabled" : "Disabled"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              aria-label="Test connection"
              className="rounded-lg border border-border p-2 hover:bg-muted"
              disabled={busy}
              onClick={() => void testConnection()}
              title="Test connection"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              aria-label={
                item.isEnabled ? "Disable connection" : "Enable connection"
              }
              className="rounded-lg border border-border p-2 hover:bg-muted"
              disabled={busy}
              onClick={() =>
                void mutate(
                  `/exchange-connections/${id}/${item.isEnabled ? "disable" : "enable"}`,
                  item.isEnabled
                    ? "Connection disabled."
                    : "Connection enabled.",
                )
              }
              title={
                item.isEnabled ? "Disable connection" : "Enable connection"
              }
            >
              <Power className="h-4 w-4" />
            </button>
            <button
              aria-label="Delete connection"
              className="rounded-lg border border-red-400/30 p-2 text-red-300 hover:bg-red-400/10"
              disabled={busy}
              onClick={() => void remove()}
              title="Delete connection"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm">
          <CheckCircle2
            className={
              item.isVerified
                ? "h-4 w-4 text-emerald-300"
                : "h-4 w-4 text-amber-300"
            }
          />
          {item.isVerified
            ? `Verified ${item.verifiedAt ? new Date(item.verifiedAt).toLocaleString() : ""}`
            : "Not verified"}
          {item.lastErrorCode && (
            <span className="text-red-300">· {item.lastErrorCode}</span>
          )}
        </div>
        <div className="mt-3">
          <Feedback error={error} success={message} />
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold">Account summary</h2>
        {!privateEnabled && (
          <p className="mt-3 text-sm text-muted-foreground">
            Enable and verify this connection to load private account data.
          </p>
        )}
        {account.data && (
          <div className="mt-4 grid gap-4 border-y border-border py-5 sm:grid-cols-4">
            {[
              ["Equity", account.data.totalEquity],
              ["Available", account.data.availableBalance],
              ["Margin", account.data.totalMarginBalance],
              ["Unrealized PnL", account.data.totalUnrealizedPnl],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-sm">{value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <DataTable
        title="Balances"
        headers={["Asset", "Total", "Available", "Unrealized PnL"]}
        rows={
          balances.data?.map((row) => [
            row.asset,
            row.total,
            row.available,
            row.unrealizedPnl ?? "-",
          ]) ?? []
        }
      />
      <DataTable
        title="Positions"
        headers={["Symbol", "Side", "Quantity", "Entry", "PnL"]}
        rows={
          positions.data?.map((row) => [
            row.symbol,
            row.side,
            row.quantity,
            row.entryPrice,
            row.unrealizedPnl,
          ]) ?? []
        }
      />
      <DataTable
        title="Open orders"
        headers={["Symbol", "Side", "Type", "Price", "Filled"]}
        rows={
          orders.data?.map((row) => [
            row.symbol,
            row.side,
            row.type,
            row.price ?? "-",
            `${row.executedQuantity} / ${row.originalQuantity}`,
          ]) ?? []
        }
      />

      <div className="grid gap-8 border-t border-border pt-8 lg:grid-cols-2">
        <form
          className="grid content-start gap-4"
          onSubmit={(event) => void save(event)}
        >
          <h2 className="font-semibold">Connection details</h2>
          <Field
            defaultValue={item.displayName ?? ""}
            label="Display name"
            maxLength={64}
            name="displayName"
          />
          <button className={buttonClass} disabled={busy}>
            Save name
          </button>
        </form>
        <form
          className="grid content-start gap-4"
          onSubmit={(event) => void replaceCredentials(event)}
        >
          <h2 className="font-semibold">Replace credentials</h2>
          <p className="text-xs text-muted-foreground">
            Stored values remain hidden. Enter a complete replacement set.
          </p>
          <Field
            autoComplete="off"
            label="New API key"
            name="apiKey"
            required
          />
          <Field
            autoComplete="new-password"
            label="New API secret"
            name="apiSecret"
            required
            type="password"
          />
          {item.provider === "OKX_FUTURES" && (
            <Field
              autoComplete="new-password"
              label="New passphrase"
              name="passphrase"
              required
              type="password"
            />
          )}
          <Field
            autoComplete="current-password"
            label="Current password"
            name="password"
            required
            type="password"
          />
          <Field
            inputMode="numeric"
            label="2FA code (when enabled)"
            maxLength={6}
            name="totpCode"
          />
          <button className={buttonClass} disabled={busy}>
            Replace credentials
          </button>
        </form>
      </div>
    </section>
  );
}

function DataTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}): React.JSX.Element {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              {headers.map((header) => (
                <th className="px-3 py-3 font-medium" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                {row.map((value, cell) => (
                  <td
                    className="px-3 py-3 font-mono text-xs"
                    key={`${title}-${index}-${cell}`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="px-3 py-5 text-muted-foreground"
                  colSpan={headers.length}
                >
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
