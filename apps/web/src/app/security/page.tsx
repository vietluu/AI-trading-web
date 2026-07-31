"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionViewSchema } from "@platform/shared";
import { z } from "zod";
import { useState, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export default function SecurityPage(): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () =>
      apiRequestValidated("/auth/sessions", z.array(sessionViewSchema)),
    retry: false,
  });
  async function changePassword(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(undefined);
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
        }),
      });
      formElement.reset();
      setMessage("Password changed; other devices were signed out.");
      await client.invalidateQueries({ queryKey: ["sessions"] });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Password change failed",
      );
    }
  }
  async function remove(id: string): Promise<void> {
    setError(undefined);
    try {
      await apiRequest(`/auth/sessions/${id}`, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: ["sessions"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revoke failed");
    }
  }
  async function removeAll(): Promise<void> {
    setError(undefined);
    try {
      await apiRequest("/auth/sessions", { method: "DELETE" });
      window.location.assign("/login");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Logout failed");
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">Security</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2 w-full">
        <form
          className="grid content-start gap-4 rounded-xl border border-border bg-card p-6 w-full"
          onSubmit={(event) => void changePassword(event)}
        >
          <h2 className="font-semibold">Change password</h2>
          <Field
            label="Current password"
            name="currentPassword"
            type="password"
            required
          />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            minLength={12}
            required
          />
          <Feedback error={error} success={message} />
          <button className={buttonClass}>Change password</button>
        </form>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Active sessions</h2>
            <button
              className="text-xs text-red-300"
              onClick={() => void removeAll()}
              type="button"
            >
              Log out all devices
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {sessions.data?.map((session) => (
              <div
                className="rounded-lg border border-border p-3 text-xs"
                key={session.id}
              >
                <div className="flex justify-between">
                  <strong>
                    {session.current
                      ? "This device"
                      : (session.ip ?? "Unknown device")}
                  </strong>
                  <button
                    className="text-red-300"
                    onClick={() => void remove(session.id)}
                    type="button"
                  >
                    Revoke
                  </button>
                </div>
                <p className="mt-1 truncate text-muted-foreground">
                  {session.userAgent ?? "Unknown browser"}
                </p>
                <p className="text-muted-foreground">
                  Last active {new Date(session.lastActivity).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
