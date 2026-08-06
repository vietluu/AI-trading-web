"use client";

import { useState, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import {
  buttonClass,
  Feedback,
  Field,
  SelectField,
} from "@/components/form-controls";
import { useCredentials } from "@/hooks/credentials/useCredentials";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { createCredential, deleteCredential, testCredential } from "@/services/credentials.service";
const providers = ["OPENAI", "BINANCE", "OKX", "NEWS_API", "CUSTOM"];

export default function ApiKeysPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [totpCode, setTotpCode] = useState("");
  const credentials = useCredentials();
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await createCredential({
        provider: form.get("provider"),
        label: form.get("label") || undefined,
        apiKey: form.get("apiKey"),
        secret: form.get("secret") || undefined,
        passphrase: form.get("passphrase") || undefined,
      }, totpCode);
      formElement.reset();
      setTotpCode("");
      setMessage(t.apiKeys.successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.apiKeys.errorSave);
    }
  }
  async function action(
    path: string,
    method: "POST" | "DELETE",
    messageText: string,
  ): Promise<void> {
    setError(undefined);
    setMessage(undefined);
    try {
      if (method === "POST") {
        await testCredential(path.replace("/credentials/", "").replace("/test", ""), totpCode);
      } else {
        await deleteCredential(path.replace("/credentials/", ""), totpCode);
      }
      setTotpCode("");
      setMessage(messageText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.apiKeys.errorAction);
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">{t.apiKeys.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.apiKeys.subtitle}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form
          className="grid content-start gap-4 rounded-xl border border-border bg-card p-6"
          onSubmit={(event) => void create(event)}
        >
          <h2 className="font-semibold">{t.apiKeys.addCredential}</h2>
          <SelectField label={t.apiKeys.provider} name="provider">
            {providers.map((provider) => (
              <option key={provider}>{provider}</option>
            ))}
          </SelectField>
          <Field label={t.apiKeys.labelOptional} name="label" />
          <Field autoComplete="off" label={t.apiKeys.apiKey} name="apiKey" required />
          <Field
            autoComplete="new-password"
            label={t.apiKeys.secretOptional}
            name="secret"
            type="password"
          />
          <Field
            inputMode="numeric"
            label={t.apiKeys.totpCode}
            maxLength={6}
            onChange={(event) => setTotpCode(event.target.value)}
            value={totpCode}
          />
          <Field
            autoComplete="new-password"
            label={t.apiKeys.passphraseOptional}
            name="passphrase"
            type="password"
          />
          <Feedback error={error} success={message} />
          <button className={buttonClass}>{t.apiKeys.encryptAndSave}</button>
        </form>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">{t.apiKeys.configuredProviders}</h2>
          <div className="mt-4 grid gap-3">
            {providers.map((provider) => {
              const entries =
                credentials.data?.filter(
                  (item) => item.provider === provider,
                ) ?? [];
              return (
                <div
                  className="rounded-lg border border-border p-3"
                  key={provider}
                >
                  <div className="flex justify-between text-sm">
                    <strong>{provider}</strong>
                    <span
                      className={
                        entries.length
                          ? "text-emerald-300"
                          : "text-muted-foreground"
                      }
                    >
                      {entries.length ? t.apiKeys.configured : t.apiKeys.notConfigured}
                    </span>
                  </div>
                  {entries.map((item) => (
                    <div
                      className="mt-3 border-t border-border pt-3 text-xs"
                      key={item.id}
                    >
                      <p>
                        {item.label ?? t.apiKeys.defaultLabel} · {item.maskedKey}
                      </p>
                      <p className="text-muted-foreground">
                        {item.status} ·{" "}
                        {item.lastVerified
                          ? new Date(item.lastVerified).toLocaleString()
                          : "Never verified"}
                      </p>
                      <div className="mt-2 flex gap-3">
                        <button
                          className="text-emerald-300"
                          type="button"
                          onClick={() =>
                            void action(
                              `/credentials/${item.id}/test`,
                              "POST",
                              "Encrypted storage verified.",
                            )
                          }
                        >
                          {t.apiKeys.testStorage}
                        </button>
                        <button
                          className="text-red-300"
                          type="button"
                          onClick={() =>
                            void action(
                              `/credentials/${item.id}`,
                              "DELETE",
                              "Credential deleted.",
                            )
                          }
                        >
                          {t.apiKeys.delete}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
