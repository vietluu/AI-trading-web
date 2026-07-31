"use client";

import { useQuery } from "@tanstack/react-query";
import { publicUserSchema } from "@platform/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AccountNav } from "@/components/account-nav";
import { buttonClass } from "@/components/form-controls";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export default function ProfilePage(): React.JSX.Element {
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string>();
  const user = useQuery({
    queryKey: ["me"],
    queryFn: () => apiRequestValidated("/auth/me", publicUserSchema),
    retry: false,
  });
  async function logout(): Promise<void> {
    setLogoutError(undefined);
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      router.push("/login");
    } catch (caught) {
      setLogoutError(
        caught instanceof Error ? caught.message : "Logout failed",
      );
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">Profile</h1>
      {user.isLoading && <p className="mt-6 text-muted-foreground">Loading…</p>}
      {user.error && (
        <p className="mt-6 text-red-300">
          {user.error.message}.{" "}
          <button onClick={() => router.push("/login")}>Sign in</button>
        </p>
      )}
      {user.data && (
        <div className="mt-6 grid max-w-xl gap-4 rounded-xl border border-border bg-card p-6">
          <div>
            <p className="text-xs text-muted-foreground">Username</p>
            <p>{user.data.username}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Security</p>
            <p>
              {user.data.emailVerified
                ? "Email verified"
                : "Email not verified"}{" "}
              · {user.data.totpEnabled ? "2FA enabled" : "2FA not enabled"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p>{user.data.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Member since</p>
            <p>{new Date(user.data.createdAt).toLocaleDateString()}</p>
          </div>
          <button className={buttonClass} onClick={() => void logout()}>
            Log out
          </button>
          {logoutError && <p className="text-sm text-red-300">{logoutError}</p>}
        </div>
      )}
    </section>
  );
}
