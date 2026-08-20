"use client";

import { useEffect, useState, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import { buttonClass, Field, SelectField, Feedback } from "@/components/form-controls";
import { useAppSettings } from "@/hooks/settings/useSettings";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { apiRequest } from "@/lib/api-client";

const AVAILABLE_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

const POPULAR_SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "BNB-USDT",
  "XRP-USDT",
  "DOGE-USDT",
  "ADA-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "NEAR-USDT",
  "SUI-USDT",
];

const TIMEZONES = [
  { label: "UTC (GMT+0)", value: "UTC" },
  { label: "Vietnam / Bangkok (GMT+7)", value: "Asia/Ho_Chi_Minh" },
  { label: "Tokyo / Seoul (GMT+9)", value: "Asia/Tokyo" },
  { label: "London (GMT+0)", value: "Europe/London" },
  { label: "New York (GMT-5)", value: "America/New_York" },
];

export default function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const { settingsQuery, saveMutation } = useAppSettings();

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([]);
  const [customSymbolInput, setCustomSymbolInput] = useState("");
  const [dynamicSymbols, setDynamicSymbols] = useState<string[]>(POPULAR_SYMBOLS);

  useEffect(() => {
    if (settingsQuery.data) {
      setSelectedSymbols(settingsQuery.data.preferredSymbols ?? []);
      setSelectedTimeframes(settingsQuery.data.preferredTimeframes ?? []);
    }
  }, [settingsQuery.data]);

  const selectedExchange = settingsQuery.data?.preferredExchange ?? "OKX_FUTURES";

  useEffect(() => {
    async function loadSymbols() {
      try {
        const url = selectedExchange
          ? `/exchanges/symbols?provider=${encodeURIComponent(selectedExchange)}`
          : "/exchanges/symbols";
        const data = await apiRequest<Array<{ symbol: string; isCommon: boolean }>>(url);
        if (Array.isArray(data) && data.length > 0) {
          setDynamicSymbols(data.map((item) => item.symbol));
        }
      } catch {
        // Fallback to POPULAR_SYMBOLS if offline
      }
    }
    void loadSymbols();
  }, [selectedExchange]);

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  };

  const addCustomSymbol = () => {
    const trimmed = customSymbolInput.trim().toUpperCase();
    if (trimmed && !selectedSymbols.includes(trimmed)) {
      const formatted = trimmed.includes("-") ? trimmed : `${trimmed}-USDT`;
      setSelectedSymbols((prev) => [...prev, formatted]);
      setCustomSymbolInput("");
    }
  };

  const toggleTimeframe = (tf: string) => {
    setSelectedTimeframes((prev) =>
      prev.includes(tf) ? prev.filter((t) => t !== tf) : [...prev, tf],
    );
  };

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setSuccessMessage(undefined);
    setErrorMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await saveMutation.mutateAsync({
        theme: form.get("theme"),
        timezone: form.get("timezone"),
        preferredExchange: form.get("preferredExchange"),
        preferredSymbols: selectedSymbols,
        preferredTimeframes: selectedTimeframes.length > 0 ? selectedTimeframes : ["15m"],
        aiDailyBudget: form.get("aiDailyBudget")
          ? Number(form.get("aiDailyBudget"))
          : undefined,
        defaultLeverage: form.get("defaultLeverage")
          ? Number(form.get("defaultLeverage"))
          : undefined,
        riskPreference: form.get("riskPreference"),
        maxRiskPerTrade: form.get("maxRiskPerTradePct")
          ? Number(form.get("maxRiskPerTradePct")) / 100
          : undefined,
      });
      setSuccessMessage("Settings saved successfully!");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <AccountNav />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your personal AI trading parameters, risk tolerance, and exchange preferences.
        </p>
      </div>

      {settingsQuery.data && (
        <form
          className="mt-6 grid max-w-3xl gap-6 rounded-2xl border border-border/80 bg-card/60 p-6 backdrop-blur-md md:grid-cols-2"
          key={settingsQuery.data.theme + settingsQuery.data.timezone}
          onSubmit={(event) => void save(event)}
        >
          {/* Theme */}
          <SelectField
            defaultValue={settingsQuery.data.theme}
            label={t.settings.theme}
            name="theme"
          >
            <option value="dark">{t.settings.dark}</option>
            <option value="light">{t.settings.light}</option>
            <option value="system">{t.settings.system}</option>
          </SelectField>

          {/* Timezone Dropdown */}
          <SelectField
            defaultValue={settingsQuery.data.timezone ?? "Asia/Ho_Chi_Minh"}
            label={t.settings.timezone}
            name="timezone"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </SelectField>

          {/* Preferred Exchange */}
          <SelectField
            defaultValue={settingsQuery.data.preferredExchange ?? "BINANCE"}
            label={t.settings.preferredExchange}
            name="preferredExchange"
          >
            <option value="BINANCE">Binance USD-M Futures</option>
            <option value="OKX">OKX Perpetual Swaps</option>
          </SelectField>

          {/* Risk Preference */}
          <SelectField
            defaultValue={settingsQuery.data.riskPreference ?? "MODERATE"}
            label={t.settings.riskPreference}
            name="riskPreference"
          >
            <option value="CONSERVATIVE">{t.settings.conservative} (1% Risk / Trade)</option>
            <option value="MODERATE">{t.settings.moderate} (2% Risk / Trade)</option>
            <option value="AGGRESSIVE">{t.settings.aggressive} (higher exposure, hard risk cap applies)</option>
          </SelectField>

          <Field
            defaultValue={(settingsQuery.data.maxRiskPerTrade ?? 0.02) * 100}
            label="Maximum risk per trade (%)"
            max="2"
            min="0.1"
            name="maxRiskPerTradePct"
            step="0.1"
            type="number"
          />

          {/* Default Leverage */}
          <Field
            defaultValue={settingsQuery.data.defaultLeverage ?? 3}
            label={t.settings.defaultLeverage}
            max="125"
            min="1"
            name="defaultLeverage"
            type="number"
          />

          {/* AI Daily Budget */}
          <Field
            defaultValue={settingsQuery.data.aiDailyBudget}
            label={t.settings.aiDailyBudget}
            min="0"
            name="aiDailyBudget"
            step="0.01"
            type="number"
          />

          {/* Preferred Timeframes Multi-Select Chips */}
          <div className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-muted-foreground">
              {t.settings.timeframes} (Multi-Select)
            </span>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TIMEFRAMES.map((tf) => {
                const isSelected = selectedTimeframes.includes(tf);
                return (
                  <button
                    key={tf}
                    className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      isSelected
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20"
                        : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60"
                    }`}
                    onClick={() => toggleTimeframe(tf)}
                    type="button"
                  >
                    {tf} {isSelected && "✓"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preferred Symbols Multi-Select & Real-Time Search Box */}
          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {t.settings.symbols} (Watchlist & Pipeline Defaults)
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedSymbols.length} selected
              </span>
            </div>

            {/* Selected Chips */}
            <div className="flex flex-wrap gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 min-h-[48px]">
              {selectedSymbols.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">
                  No symbols selected. Search and click tokens below to add.
                </span>
              ) : (
                selectedSymbols.map((sym) => (
                  <span
                    key={sym}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
                  >
                    {sym}
                    <button
                      className="text-emerald-400/70 hover:text-red-400 transition-colors"
                      onClick={() => toggleSymbol(sym)}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Real-Time Token Search Input */}
            <div className="space-y-2">
              <div className="relative">
                <input
                  className="w-full rounded-xl border border-border/80 bg-background px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30 transition-all"
                  onChange={(e) => setCustomSymbolInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const firstMatch = dynamicSymbols.find((s) =>
                        s.toLowerCase().includes(customSymbolInput.trim().toLowerCase())
                      );
                      if (firstMatch) toggleSymbol(firstMatch);
                      else addCustomSymbol();
                    }
                  }}
                  placeholder="🔍 Search tokens (e.g. SOL, PEPE, DOGE, BTC)..."
                  value={customSymbolInput}
                />
              </div>

              {/* Dynamic Tokens List (Prioritized Top Major Coins) */}
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto rounded-xl border border-border/40 bg-muted/10 p-2.5">
                {dynamicSymbols
                  .filter((sym) =>
                    customSymbolInput
                      ? sym.toLowerCase().includes(customSymbolInput.trim().toLowerCase())
                      : true
                  )
                  .slice(0, customSymbolInput ? 50 : 35)
                  .map((sym) => {
                    const isSelected = selectedSymbols.includes(sym);
                    return (
                      <button
                        key={sym}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                          isSelected
                            ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 shadow-sm shadow-emerald-500/10"
                            : "border-border/50 bg-card text-muted-foreground hover:border-border hover:bg-muted"
                        }`}
                        onClick={() => toggleSymbol(sym)}
                        type="button"
                      >
                        {isSelected ? `✓ ${sym}` : `+ ${sym}`}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Feedback & Actions */}
          <div className="flex flex-col gap-3 md:col-span-2 pt-2">
            <Feedback error={errorMessage} success={successMessage} />
            <div>
              <button className={buttonClass} disabled={busy}>
                {busy ? t.settings.saving : t.settings.saveSettings}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

