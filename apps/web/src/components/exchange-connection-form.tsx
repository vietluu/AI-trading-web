"use client";

import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  buttonClass,
  Feedback,
  Field,
  SelectField,
} from "@/components/form-controls";
import { apiRequest } from "@/lib/api-client";

type Provider = "BINANCE_FUTURES" | "OKX_FUTURES";

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function ExchangeConnectionForm({
  onCreated,
}: {
  onCreated: (id: string) => void;
}): React.JSX.Element {
  const [provider, setProvider] = useState<Provider>("OKX_FUTURES");
  const [environment, setEnvironment] = useState("DEMO");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function selectProvider(value: Provider): void {
    setProvider(value);
    setEnvironment(value === "BINANCE_FUTURES" ? "TESTNET" : "DEMO");
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const password = formString(form, "password");
      if (environment === "PRODUCTION" && password) {
        await apiRequest("/auth/reauthenticate", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
      }
      const result = await apiRequest<{ id: string }>("/exchange-connections", {
        method: "POST",
        ...(formString(form, "totpCode")
          ? { headers: { "X-TOTP-Code": formString(form, "totpCode") } }
          : {}),
        body: JSON.stringify({
          provider,
          environment,
          displayName: form.get("displayName") || undefined,
          apiKey: form.get("apiKey"),
          apiSecret: form.get("apiSecret"),
          passphrase:
            provider === "OKX_FUTURES" ? form.get("passphrase") : undefined,
          testConnection: true,
        }),
      });
      onCreated(result.id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Connection could not be created",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid max-w-2xl gap-5"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Provider"
          name="provider"
          onChange={(event) => selectProvider(event.target.value as Provider)}
          value={provider}
        >
          <option value="BINANCE_FUTURES">Binance USD-M Futures</option>
          <option value="OKX_FUTURES">OKX Perpetual Swaps</option>
        </SelectField>
        <SelectField
          label="Environment"
          name="environment"
          onChange={(event) => setEnvironment(event.target.value)}
          value={environment}
        >
          {provider === "BINANCE_FUTURES" ? (
            <option>TESTNET</option>
          ) : (
            <option>DEMO</option>
          )}
          <option>PRODUCTION</option>
        </SelectField>
      </div>
      {environment === "PRODUCTION" && (
        <div className="flex gap-3 border-l-2 border-amber-400 bg-amber-400/5 p-4 text-sm text-amber-100">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          Production access is disabled by default. Use a dedicated key, disable
          withdrawal, and restrict it by IP.
        </div>
      )}
      <Field label="Display name" maxLength={64} name="displayName" />
      <Field
        autoComplete="off"
        label="API key"
        maxLength={512}
        name="apiKey"
        required
      />
      <div className="relative">
        <Field
          autoComplete="new-password"
          label="API secret"
          maxLength={512}
          name="apiSecret"
          required
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={visible ? "Hide secrets" : "Show secrets"}
          className="absolute bottom-2 right-3 text-muted-foreground"
          onClick={() => setVisible((value) => !value)}
          title={visible ? "Hide secrets" : "Show secrets"}
          type="button"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
      {provider === "OKX_FUTURES" && (
        <Field
          autoComplete="new-password"
          label="Passphrase"
          maxLength={512}
          name="passphrase"
          required
          type={visible ? "text" : "password"}
        />
      )}
      {environment === "PRODUCTION" && (
        <Field
          autoComplete="current-password"
          label="Current password"
          name="password"
          required
          type="password"
        />
      )}
      <Field
        inputMode="numeric"
        label="2FA code (when enabled)"
        maxLength={6}
        name="totpCode"
      />
      <Feedback error={error} />
      <div>
        <button className={buttonClass} disabled={busy}>
          {busy ? "Connecting..." : "Create and test connection"}
        </button>
      </div>
    </form>
  );
}
