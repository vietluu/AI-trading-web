"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest } from "@/lib/api-client";

export default function ForgotPasswordPage(): React.JSX.Element {
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
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Reset password</h1>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Email" name="email" type="email" required />
        <Feedback error={error} success={message} />
        <button className={buttonClass} disabled={busy}>
          {busy ? "Requesting…" : "Request reset"}
        </button>
      </form>
    </section>
  );
}
