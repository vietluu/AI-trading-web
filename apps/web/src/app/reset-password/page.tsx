"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { ROUTES } from "@/constants/routes";

export default function ResetPasswordPage(): React.JSX.Element {
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
    const token =
      new URLSearchParams(window.location.search).get("token") ?? "";
    const newPasswordEntry = form.get("newPassword");
    const confirmPasswordEntry = form.get("confirmPassword");
    const newPassword =
      typeof newPasswordEntry === "string" ? newPasswordEntry : "";
    const confirmPassword =
      typeof confirmPasswordEntry === "string" ? confirmPasswordEntry : "";
    if (!token) {
      setError(t.auth.resetTokenMissing);
      setBusy(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.auth.passwordsDoNotMatch);
      setBusy(false);
      return;
    }
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
      setMessage(t.auth.passwordResetSuccess);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.auth.resetFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">{t.auth.chooseNewPassword}</h1>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        <Field
          autoComplete="new-password"
          label={t.auth.newPassword}
          minLength={12}
          name="newPassword"
          type="password"
          required
        />
        <Field
          autoComplete="new-password"
          label={t.auth.confirmNewPassword}
          minLength={12}
          name="confirmPassword"
          type="password"
          required
        />
        <Feedback error={error} success={message} />
        <button className={buttonClass} disabled={busy || Boolean(message)}>
          {busy ? t.auth.resetting : t.auth.resetPasswordAction}
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link className="text-primary hover:underline" href={ROUTES.login}>
          {t.auth.returnToSignIn}
        </Link>
      </p>
    </section>
  );
}
