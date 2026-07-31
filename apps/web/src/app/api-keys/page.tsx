"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { credentialViewSchema } from "@platform/shared";
import { z } from "zod";
import { useState, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import {
  buttonClass,
  Feedback,
  Field,
  SelectField,
} from "@/components/form-controls";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";
const providers = ["OPENAI", "BINANCE", "OKX", "NEWS_API", "CUSTOM"];

export default function ApiKeysPage(): React.JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const credentials = useQuery({
    queryKey: ["credentials"],
    queryFn: () =>
      apiRequestValidated("/credentials", z.array(credentialViewSchema)),
    retry: false,
  });
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await apiRequest("/credentials", {
        method: "POST",
        body: JSON.stringify({
          provider: form.get("provider"),
          label: form.get("label") || undefined,
          apiKey: form.get("apiKey"),
          secret: form.get("secret") || undefined,
          passphrase: form.get("passphrase") || undefined,
        }),
      });
      formElement.reset();
      setMessage("Credential encrypted and saved.");
      await client.invalidateQueries({ queryKey: ["credentials"] });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save credential",
      );
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
      await apiRequest(path, { method });
      setMessage(messageText);
      await client.invalidateQueries({ queryKey: ["credentials"] });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not complete credential action",
      );
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">API keys</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Secrets are encrypted at rest and are never returned after saving.
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form
          className="grid content-start gap-4 rounded-xl border border-border bg-card p-6"
          onSubmit={(event) => void create(event)}
        >
          <h2 className="font-semibold">Add credential</h2>
          <SelectField label="Provider" name="provider">
            {providers.map((provider) => (
              <option key={provider}>{provider}</option>
            ))}
          </SelectField>
          <Field label="Label (optional)" name="label" />
          <Field autoComplete="off" label="API key" name="apiKey" required />
          <Field
            autoComplete="new-password"
            label="Secret (optional)"
            name="secret"
            type="password"
          />
          <Field
            autoComplete="new-password"
            label="Passphrase (optional)"
            name="passphrase"
            type="password"
          />
          <Feedback error={error} success={message} />
          <button className={buttonClass}>Encrypt and save</button>
        </form>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Configured providers</h2>
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
                      {entries.length ? "Configured" : "Not configured"}
                    </span>
                  </div>
                  {entries.map((item) => (
                    <div
                      className="mt-3 border-t border-border pt-3 text-xs"
                      key={item.id}
                    >
                      <p>
                        {item.label ?? "Default"} · {item.maskedKey}
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
                          Test storage
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
                          Delete
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
