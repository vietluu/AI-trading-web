"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ROUTES } from "@/constants/routes";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";

function Verification(): React.JSX.Element {
  const { t } = useTranslation();
  const token = useSearchParams().get("token");
  const [message, setMessage] = useState(t.auth.verifyingEmail);
  useEffect(() => {
    if (!token) {
      setMessage(t.auth.verificationTokenMissing);
      return;
    }
    void apiRequest("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }).then(
      () => setMessage(t.auth.emailVerified),
      (error: unknown) =>
        setMessage(
          error instanceof Error ? error.message : t.auth.verificationFailed,
        ),
    );
  }, [token, t.auth.emailVerified, t.auth.verificationFailed, t.auth.verificationTokenMissing]);
  return <p className="mt-4 text-sm text-muted-foreground">{message}</p>;
}

export default function VerifyEmailPage(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">{t.auth.verifyEmailTitle}</h1>
      <Suspense fallback={<p className="mt-4">Loading...</p>}>
        <Verification />
      </Suspense>
      <Link
        className="mt-6 inline-block text-sm text-emerald-300"
        href={ROUTES.login}
      >
        {t.auth.returnToSignIn}
      </Link>
    </section>
  );
}
