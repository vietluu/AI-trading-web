"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AccountNav } from "@/components/account-nav";
import { buttonClass } from "@/components/form-controls";
import { ROUTES } from "@/constants/routes";
import { useProfile } from "@/hooks/profile/useProfile";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { logout as logoutUser, resendVerification as resendVerificationRequest } from "@/services/auth.service";

export default function ProfilePage(): React.JSX.Element {
  const router = useRouter();
  const { t } = useTranslation();
  const [logoutError, setLogoutError] = useState<string>();
  const [resendStatus, setResendStatus] = useState<string>();
  const [resending, setResending] = useState(false);

  const user = useProfile();

  async function handleLogout(): Promise<void> {
    setLogoutError(undefined);
    try {
      await logoutUser();
      router.push(ROUTES.login);
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : t.profile.logoutFailed);
    }
  }

  async function handleResendVerification(): Promise<void> {
    if (!user.data?.email) return;
    setResending(true);
    setResendStatus(undefined);
    try {
      await resendVerificationRequest(user.data.email);
      setResendStatus(t.auth.verificationEmailRequested);
    } catch (caught) {
      setResendStatus(caught instanceof Error ? caught.message : t.profile.requestFailed);
    } finally {
      setResending(false);
    }
  }

  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">{t.profile.title}</h1>
      {user.isLoading && <p className="mt-6 text-muted-foreground">{t.profile.loading}</p>}
      {user.error && (
        <p className="mt-6 text-red-300">
          {user.error.message}.{" "}
          <button onClick={() => router.push(ROUTES.login)}>{t.profile.signIn}</button>
        </p>
      )}
      {user.data && (
        <div className="mt-6 grid max-w-xl gap-4 rounded-xl border border-border bg-card p-6">
          <div>
            <p className="text-xs text-muted-foreground">{t.profile.username}</p>
            <p className="font-semibold">{user.data.username}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t.profile.email}</p>
            <p className="font-semibold break-all">{user.data.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t.profile.securityVerification}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${user.data.emailVerified ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>
                {user.data.emailVerified ? `🟢 ${t.auth.verifyEmailVerified}` : `🔴 ${t.auth.verifyEmailNotVerified}`}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${user.data.totpEnabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                {user.data.totpEnabled ? `🟢 ${t.profile.twoFactorEnabled}` : `⚪ ${t.profile.twoFactorDisabled}`}
              </span>
            </div>
            {!user.data.emailVerified && (
              <div className="mt-2">
                <button
                  className="text-xs font-semibold text-primary hover:underline"
                  disabled={resending}
                  onClick={() => void handleResendVerification()}
                  type="button"
                >
                  {resending ? t.profile.sending : t.auth.resendVerificationEmail}
                </button>
                {resendStatus && (
                  <p className="mt-1 text-xs text-emerald-500 font-medium">{resendStatus}</p>
                )}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t.profile.memberSince}</p>
            <p>{new Date(user.data.createdAt).toLocaleDateString()}</p>
          </div>
          <button className={buttonClass} onClick={() => void handleLogout()}>
            {t.profile.logout}
          </button>
          {logoutError && <p className="text-sm text-red-300">{logoutError}</p>}
        </div>
      )}
    </section>
  );
}
