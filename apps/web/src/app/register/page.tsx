"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { register } from "@/services/auth.service";

export default function RegisterPage(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await register({
        email: form.get("email"),
        username: form.get("username"),
        password: form.get("password"),
      });
      router.push(
        result.requiresEmailVerification
          ? `${ROUTES.login}?reason=verify-email`
          : ROUTES.profile,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.auth.registrationFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">{t.auth.createYourAccount}</h1>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        <Field label={t.profile.email} name="email" type="email" required />
        <Field label={t.profile.username} name="username" minLength={3} required />
        <Field
          label={t.auth.password}
          name="password"
          type="password"
          minLength={12}
          required
        />
        <Feedback error={error} />
        <button className={buttonClass} disabled={busy}>
          {busy ? t.auth.registering : t.auth.register}
        </button>
        <Link className="text-xs text-muted-foreground" href={ROUTES.login}>
          {t.auth.alreadyRegistered}
        </Link>
      </form>
    </section>
  );
}
