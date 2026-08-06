"use client";

import { useState, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import {
  buttonClass,
  Feedback,
  Field,
  SelectField,
} from "@/components/form-controls";
import { useAppSettings } from "@/hooks/settings/useSettings";
import { useTranslation } from "@/lib/i18n/i18n-context";

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export default function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { settingsQuery, saveMutation } = useAppSettings();
  const settings = settingsQuery;
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      setMessage(t.settings.settingsSaved);
      await saveMutation.mutateAsync({
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
        });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.settings.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">{t.settings.title}</h1>
      {settings.data && (
        <form
          className="mt-6 grid max-w-2xl gap-4 rounded-xl border border-border bg-card p-6 md:grid-cols-2"
          key={settings.data.theme + settings.data.timezone}
          onSubmit={(event) => void save(event)}
        >
          <SelectField
            defaultValue={settings.data.theme}
            label={t.settings.theme}
            name="theme"
          >
            <option value="dark">{t.settings.dark}</option>
            <option value="light">{t.settings.light}</option>
            <option value="system">{t.settings.system}</option>
          </SelectField>
          <Field
            defaultValue={settings.data.timezone}
            label={t.settings.timezone}
            name="timezone"
          />
          <SelectField
            defaultValue={settings.data.preferredExchange ?? "BINANCE"}
            label={t.settings.preferredExchange}
            name="preferredExchange"
          >
            <option>BINANCE</option>
            <option>OKX</option>
          </SelectField>
          <Field
            defaultValue={settings.data.preferredSymbols.join(", ")}
            label={t.settings.symbols}
            name="preferredSymbols"
          />
          <Field
            defaultValue={settings.data.preferredTimeframes.join(", ")}
            label={t.settings.timeframes}
            name="preferredTimeframes"
          />
          <Field
            defaultValue={settings.data.aiDailyBudget}
            label={t.settings.aiDailyBudget}
            min="0"
            name="aiDailyBudget"
            step="0.01"
            type="number"
          />
          <Field
            defaultValue={settings.data.defaultLeverage}
            label={t.settings.defaultLeverage}
            max="125"
            min="1"
            name="defaultLeverage"
            type="number"
          />
          <SelectField
            defaultValue={settings.data.riskPreference}
            label={t.settings.riskPreference}
            name="riskPreference"
          >
            <option>{t.settings.conservative}</option>
            <option>{t.settings.moderate}</option>
            <option>{t.settings.aggressive}</option>
          </SelectField>
          <div className="flex items-end gap-3">
            <button className={buttonClass} disabled={busy}>
              {busy ? t.settings.saving : t.settings.saveSettings}
            </button>
            <Feedback error={error} success={message} />
          </div>
        </form>
      )}
    </section>
  );
}
