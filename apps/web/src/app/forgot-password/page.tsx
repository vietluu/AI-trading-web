"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function ForgotPasswordPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<{ message: string }>(
        "/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email: form.get("email") }) },
      );
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.auth.requestFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">{t.auth.resetPasswordTitle}</h1>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        <Field label={t.profile.email} name="email" type="email" required />
        <Feedback error={error} success={message} />
        <button className={buttonClass} disabled={busy}>
          {busy ? t.auth.requesting : t.auth.requestReset}
        </button>
      </form>
    </section>
  );
}
