"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { publicUserSchema } from "@platform/shared";

import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
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
    try {
      await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
          rememberMe: form.get("rememberMe") === "on",
        }),
      });
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
        <Field label="Email or username" name="identifier" required />
        <Field label="Password" name="password" type="password" required />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input className="h-4 w-4" name="rememberMe" type="checkbox" />
          Remember this device for 30 days
        </label>
        <Feedback error={error} />
        <button className={buttonClass} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="flex justify-between text-xs text-muted-foreground">
          <Link href="/register">Create account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </section>
  );
}
