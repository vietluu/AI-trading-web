"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest } from "@/lib/api-client";

export default function ResetPasswordPage(): React.JSX.Element {
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
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: form.get("newPassword") }),
      });
      setMessage("Password reset. You can now sign in.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <form
        className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(event) => void submit(event)}
      >
        <Field
          label="New password"
          minLength={12}
          name="newPassword"
          type="password"
          required
        />
        <Feedback error={error} success={message} />
        <button className={buttonClass} disabled={busy}>
          {busy ? "Resetting…" : "Reset password"}
        </button>
      </form>
    </section>
  );
}
