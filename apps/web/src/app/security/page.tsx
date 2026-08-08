"use client";

import { useState, type FormEvent } from "react";

import { AccountNav } from "@/components/account-nav";
import { buttonClass, Feedback, Field } from "@/components/form-controls";
import { ROUTES } from "@/constants/routes";
import { useSecuritySessions, useSecurityUser } from "@/hooks/security/useSecurity";
import { useTranslation } from "@/lib/i18n/i18n-context";
import {
  changePassword as changePasswordService,
  confirmTotp as confirmTotpCode,
  disableTotp as disableTotpService,
  removeAllSessions,
  removeSession,
  setupTotp,
} from "@/services/auth.service";

export default function SecurityPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUri: string;
  }>();
  const me = useSecurityUser();
  const sessions = useSecuritySessions();
  async function handleChangePassword(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(undefined);
    try {
      await changePasswordService({
        currentPassword: form.get("currentPassword"),
        newPassword: form.get("newPassword"),
      });
      formElement.reset();
      setMessage(t.security.passwordChanged);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.security.passwordChangeFailed);
    }
  }
  async function handleRemove(id: string): Promise<void> {
    setError(undefined);
    try {
      await removeSession(id);
      if (sessions.data?.find((session) => session.id === id)?.current) {
        window.location.assign(ROUTES.login);
        return;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.security.revokeFailed);
    }
  }
  async function beginTotp(): Promise<void> {
    setError(undefined);
    try {
      setTotpSetup(await setupTotp());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.security.totpSetupFailed);
    }
  }
  async function handleConfirmTotp(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await confirmTotpCode(form.get("code"));
      setTotpSetup(undefined);
      setMessage(t.security.totpEnabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.security.totpEnableFailed);
    }
  }
  async function handleDisableTotp(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await disableTotpService({
        currentPassword: form.get("currentPassword"),
        code: form.get("code"),
      });
      setMessage(t.security.totpDisabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.security.totpDisableFailed);
    }
  }
  async function handleRemoveAll(): Promise<void> {
    setError(undefined);
    try {
      await removeAllSessions();
      window.location.assign(ROUTES.login);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.security.logoutFailed);
    }
  }
  return (
    <section>
      <AccountNav />
      <h1 className="text-3xl font-semibold">{t.security.title}</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2 w-full">
        <form
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 w-full"
          onSubmit={(event) => void handleChangePassword(event)}
        >
          <h2 className="font-semibold">{t.security.changePassword}</h2>
          <Field
            label={t.security.currentPassword}
            name="currentPassword"
            type="password"
            required
          />
          <Field
            label={t.security.newPassword}
            name="newPassword"
            type="password"
            minLength={12}
            required
          />
          <Feedback error={error} success={message} />
          <button className={buttonClass}>{t.security.changePassword}</button>
        </form>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t.security.activeSessions}</h2>
            <button
              className="text-xs text-red-300"
              onClick={() => void handleRemoveAll()}
              type="button"
            >
              {t.security.logOutAllDevices}
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {sessions.data?.map((session) => (
              <div
                className="rounded-lg border border-border p-3 text-xs min-w-0 break-all"
                key={session.id}
              >
                <div className="flex justify-between items-center gap-2">
                  <strong className="truncate">
                    {session.current
                      ? t.security.thisDevice
                      : (session.ip ?? t.security.unknownDevice)}
                  </strong>
                  <button
                    className="shrink-0 text-red-300 hover:underline"
                    onClick={() => void handleRemove(session.id)}
                    type="button"
                  >
                    {t.security.revoke}
                  </button>
                </div>
                <p className="mt-1 text-muted-foreground break-all">
                  {session.userAgent ?? t.security.unknownBrowser}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {t.security.lastActive} {new Date(session.lastActivity).toLocaleString()}
                </p>
                <p className="text-muted-foreground">
                  {session.rememberMe ? "Remembered device" : "Browser session"}{" "}
                  · expires {new Date(session.expiresAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border pt-6 lg:col-span-2">
          <h2 className="font-semibold">{t.security.twoFactorAuth}</h2>
          {!me.data?.totpEnabled && !totpSetup && (
            <button
              className={`${buttonClass} mt-4`}
              onClick={() => void beginTotp()}
              type="button"
            >
              {t.security.setupAuthenticator}
            </button>
          )}
          {totpSetup && (
            <form
              className="mt-4 grid max-w-xl gap-4 rounded-xl border border-border bg-card p-5"
              onSubmit={(event) => void handleConfirmTotp(event)}
            >
              <div className="flex flex-col sm:flex-row items-center gap-4 border-b border-border pb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="2FA QR Code"
                  className="h-44 w-44 rounded-lg border border-border p-2 bg-white"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpSetup.otpauthUri)}`}
                />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-sm">{t.security.scanQrCodeTitle}</p>
                  <p className="text-muted-foreground">{t.security.scanQrCodeDesc}</p>
                  <p className="pt-2">{t.security.manualKey}</p>
                  <code className="block rounded bg-muted px-2 py-1 font-mono text-sm font-bold tracking-wider text-primary select-all">
                    {totpSetup.secret}
                  </code>
                </div>
              </div>
              <Field
                inputMode="numeric"
                label={t.auth.totpCodeLabel}
                maxLength={6}
                name="code"
                required
              />
              <button className={buttonClass}>{t.security.confirm2FA}</button>
            </form>
          )}
          {me.data?.totpEnabled && (
            <form
              className="mt-4 grid max-w-xl gap-3"
              onSubmit={(event) => void handleDisableTotp(event)}
            >
              <Field
                label={t.security.currentPassword}
                name="currentPassword"
                type="password"
                required
              />
              <Field
                inputMode="numeric"
                label={t.auth.totpCodeLabel}
                maxLength={6}
                name="code"
                required
              />
              <button className={buttonClass}>{t.security.disable2FA}</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
