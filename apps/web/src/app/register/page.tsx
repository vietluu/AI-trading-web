"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest } from "@/lib/api-client";

export default function RegisterPage(): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<{ requiresEmailVerification: boolean }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            username: form.get("username"),
            password: form.get("password"),
          }),
        },
      );
      router.push(
        result.requiresEmailVerification
          ? "/login?reason=verify-email"
          : "/profile",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Registration failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Email" name="email" type="email" required />
        <Field label="Username" name="username" minLength={3} required />
        <Field
          label="Password (12+ chars, use uppercase, number and symbol)"
          name="password"
          type="password"
          minLength={12}
          required
        />
        <Feedback error={error} />
        <button className={buttonClass} disabled={busy}>
          {busy ? "Creating…" : "Register"}
        </button>
        <Link className="text-xs text-muted-foreground" href="/login">
          Already registered? Sign in
        </Link>
      </form>
    </section>
  );
}
