"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsViewSchema } from "@platform/shared";
import { useState, useEffect, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import {
  buttonClass,
  Feedback,
  Field,
  SelectField,
} from "@/components/form-controls";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export default function SettingsPage(): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [theme, setTheme] = useState("dark");
  const [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");
  const [preferredExchange, setPreferredExchange] = useState("OKX");
  const [preferredSymbols, setPreferredSymbols] = useState("BTC-USDT, ETH-USDT, SOL-USDT, BNB-USDT");
  const [preferredTimeframes, setPreferredTimeframes] = useState("15m, 1h");
  const [aiDailyBudget, setAiDailyBudget] = useState(500);
  const [defaultLeverage, setDefaultLeverage] = useState(5);
  const [riskPreference, setRiskPreference] = useState("MODERATE");

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiRequestValidated("/settings", settingsViewSchema),
    retry: false,
  });

  useEffect(() => {
    if (settings.data) {
      setTheme(settings.data.theme || "dark");
      setTimezone(settings.data.timezone || "Asia/Ho_Chi_Minh");
      setPreferredExchange(settings.data.preferredExchange || "OKX");
      if (settings.data.preferredSymbols?.length) {
        setPreferredSymbols(settings.data.preferredSymbols.join(", "));
      }
      if (settings.data.preferredTimeframes?.length) {
        setPreferredTimeframes(settings.data.preferredTimeframes.join(", "));
      }
      if (settings.data.aiDailyBudget != null) {
        setAiDailyBudget(Number(settings.data.aiDailyBudget));
      }
      if (settings.data.defaultLeverage != null) {
        setDefaultLeverage(settings.data.defaultLeverage);
      }
      if (settings.data.riskPreference) {
        setRiskPreference(settings.data.riskPreference);
      }
    }
  }, [settings.data]);

  function applyOptimalPresets(): void {
    setTheme("dark");
    setTimezone("Asia/Ho_Chi_Minh");
    setPreferredExchange("OKX");
    setPreferredSymbols("BTC-USDT, ETH-USDT, SOL-USDT, BNB-USDT");
    setPreferredTimeframes("15m, 1h");
    setAiDailyBudget(500);
    setDefaultLeverage(5);
    setRiskPreference("MODERATE");
    setMessage("Applied optimal presets! Click 'Save settings' to submit.");
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/settings", {
        method: "PUT",
        body: JSON.stringify({
          theme: form.get("theme"),
          timezone: form.get("timezone"),
          preferredExchange: form.get("preferredExchange"),
          preferredSymbols: formString(form, "preferredSymbols")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          preferredTimeframes: formString(form, "preferredTimeframes")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          aiDailyBudget: formString(form, "aiDailyBudget")
            ? Number(formString(form, "aiDailyBudget"))
            : undefined,
          defaultLeverage: formString(form, "defaultLeverage")
            ? Number(formString(form, "defaultLeverage"))
            : undefined,
          riskPreference: form.get("riskPreference"),
        }),
      });
      setMessage("Settings saved successfully!");
      await client.invalidateQueries({ queryKey: ["settings"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <AccountNav />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure default preferences for AI agents, exchange routing, and risk parameters.
          </p>
        </div>
        <button
          className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400"
          onClick={applyOptimalPresets}
          type="button"
        >
          ⚡ Điền Cấu Hình Tối Ưu (1-Click Presets)
        </button>
      </div>

      {settings.data && (
        <form
          className="grid max-w-2xl gap-4 rounded-xl border border-border bg-card p-6 md:grid-cols-2"
          onSubmit={(event) => void save(event)}
        >
          <SelectField
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            label="Theme"
            name="theme"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </SelectField>

          <Field
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            label="Timezone"
            name="timezone"
            placeholder="Asia/Ho_Chi_Minh"
          />

          <SelectField
            value={preferredExchange}
            onChange={(e) => setPreferredExchange(e.target.value)}
            label="Preferred exchange"
            name="preferredExchange"
          >
            <option value="OKX">OKX</option>
            <option value="BINANCE">BINANCE</option>
          </SelectField>

          <Field
            value={preferredSymbols}
            onChange={(e) => setPreferredSymbols(e.target.value)}
            label="Symbols (comma-separated)"
            name="preferredSymbols"
            placeholder="BTC-USDT, ETH-USDT, SOL-USDT, BNB-USDT"
          />

          <Field
            value={preferredTimeframes}
            onChange={(e) => setPreferredTimeframes(e.target.value)}
            label="Timeframes (comma-separated)"
            name="preferredTimeframes"
            placeholder="15m, 1h"
          />

          <Field
            value={aiDailyBudget}
            onChange={(e) => setAiDailyBudget(Number(e.target.value))}
            label="AI daily budget"
            min="0"
            name="aiDailyBudget"
            step="1"
            type="number"
          />

          <Field
            value={defaultLeverage}
            onChange={(e) => setDefaultLeverage(Number(e.target.value))}
            label="Default leverage"
            max="125"
            min="1"
            name="defaultLeverage"
            type="number"
          />

          <SelectField
            value={riskPreference}
            onChange={(e) => setRiskPreference(e.target.value)}
            label="Risk preference"
            name="riskPreference"
          >
            <option value="CONSERVATIVE">CONSERVATIVE</option>
            <option value="MODERATE">MODERATE</option>
            <option value="AGGRESSIVE">AGGRESSIVE</option>
          </SelectField>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button className={buttonClass} disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
            <Feedback error={error} success={message} />
          </div>
        </form>
      )}
    </section>
  );
}
