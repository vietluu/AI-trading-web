"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { checkCurrentUser, login } from "@/services/auth.service";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [credentials, setCredentials] = useState<{
    identifier: string;
    password: string;
    rememberMe: boolean;
  }>();

  useEffect(() => {
    let active = true;
    void checkCurrentUser()
      .then(() => {
        if (active) router.replace(ROUTES.profile);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const rawId = form.get("identifier");
    const rawPass = form.get("password");
    const rawCode = form.get("code");

    const identifier = credentials?.identifier ?? (typeof rawId === "string" ? rawId : "");
    const password = credentials?.password ?? (typeof rawPass === "string" ? rawPass : "");
    const rememberMe = credentials?.rememberMe ?? (form.get("rememberMe") === "on");
    const code = requiresTotp ? (typeof rawCode === "string" ? rawCode : undefined) : undefined;

    try {
      const res = await login({ identifier, password, rememberMe, ...(code ? { code } : {}) });

      if (res.requiresTotp) {
        setRequiresTotp(true);
        setCredentials({ identifier, password, rememberMe });
        return;
      }

      router.push(ROUTES.profile);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.auth.loginFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">{t.auth.welcomeBack}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.auth.sessionHint}</p>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        {!requiresTotp ? (
          <>
            <Field label={t.auth.emailOrUsername} name="identifier" required />
            <Field label={t.auth.password} name="password" type="password" required />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input className="h-4 w-4" name="rememberMe" type="checkbox" />
              {t.auth.rememberDevice}
            </label>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-500">
              {t.auth.enter2faCode}
            </p>
            <Field
              inputMode="numeric"
              label={t.auth.totpCodeLabel}
              maxLength={6}
              name="code"
              required
              autoFocus
            />
          </div>
        )}

        <Feedback error={error} />
        <button className={buttonClass} disabled={busy}>
          {busy ? t.auth.signingIn : requiresTotp ? t.auth.verify2faButton : t.auth.signIn}
        </button>
        <div className="flex justify-between text-xs text-muted-foreground">
          <Link href={ROUTES.register}>{t.auth.createAccount}</Link>
          <Link href={ROUTES.forgotPassword}>{t.auth.forgotPassword}</Link>
        </div>
      </form>
    </section>
  );
}
