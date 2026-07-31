"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsViewSchema } from "@platform/shared";
import { useState, type FormEvent } from "react";

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
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiRequestValidated("/settings", settingsViewSchema),
    retry: false,
  });
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
          aiDailyBudget: Number(form.get("aiDailyBudget")),
          paperTradingBalance: Number(form.get("paperTradingBalance")),
          defaultLeverage: Number(form.get("defaultLeverage")),
          riskPreference: form.get("riskPreference"),
        }),
      });
      setMessage("Settings saved.");
      await client.invalidateQueries({ queryKey: ["settings"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">Settings</h1>
      {settings.data && (
        <form
          className="mt-6 grid max-w-2xl gap-4 rounded-xl border border-border bg-card p-6 md:grid-cols-2"
          key={settings.data.theme + settings.data.timezone}
          onSubmit={(event) => void save(event)}
        >
          <SelectField
            defaultValue={settings.data.theme}
            label="Theme"
            name="theme"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </SelectField>
          <Field
            defaultValue={settings.data.timezone}
            label="Timezone"
            name="timezone"
          />
          <SelectField
            defaultValue={settings.data.preferredExchange ?? "BINANCE"}
            label="Preferred exchange"
            name="preferredExchange"
          >
            <option>BINANCE</option>
            <option>OKX</option>
          </SelectField>
          <Field
            defaultValue={settings.data.preferredSymbols.join(", ")}
            label="Symbols (comma-separated)"
            name="preferredSymbols"
          />
          <Field
            defaultValue={settings.data.preferredTimeframes.join(", ")}
            label="Timeframes (comma-separated)"
            name="preferredTimeframes"
          />
          <Field
            defaultValue={settings.data.aiDailyBudget}
            label="AI daily budget"
            min="0"
            name="aiDailyBudget"
            step="0.01"
            type="number"
          />
          <Field
            defaultValue={settings.data.paperTradingBalance}
            label="Paper balance"
            min="0"
            name="paperTradingBalance"
            step="0.00000001"
            type="number"
          />
          <Field
            defaultValue={settings.data.defaultLeverage}
            label="Default leverage"
            max="125"
            min="1"
            name="defaultLeverage"
            type="number"
          />
          <SelectField
            defaultValue={settings.data.riskPreference}
            label="Risk preference"
            name="riskPreference"
          >
            <option>CONSERVATIVE</option>
            <option>MODERATE</option>
            <option>AGGRESSIVE</option>
          </SelectField>
          <div className="flex items-end gap-3">
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
