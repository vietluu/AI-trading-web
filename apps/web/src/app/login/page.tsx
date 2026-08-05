"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { publicUserSchema } from "@platform/shared";

import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";

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
    void apiRequestValidated("/auth/me", publicUserSchema)
      .then(() => {
        if (active) router.replace("/profile");
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
      const res = await apiRequest<{ requiresTotp?: boolean }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          password,
          rememberMe,
          ...(code ? { code } : {}),
        }),
      });

      if (res.requiresTotp) {
        setRequiresTotp(true);
        setCredentials({ identifier, password, rememberMe });
        return;
      }

      router.push("/profile");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your session stays in a secure HttpOnly cookie.
      </p>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        {!requiresTotp ? (
          <>
            <Field label="Email or username" name="identifier" required />
            <Field label="Password" name="password" type="password" required />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input className="h-4 w-4" name="rememberMe" type="checkbox" />
              Remember this device for 30 days
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
          {busy ? "Signing in…" : requiresTotp ? "Verify 2FA Code" : "Sign in"}
        </button>
        <div className="flex justify-between text-xs text-muted-foreground">
          <Link href="/register">Create account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </section>
  );
}
