"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { apiRequest } from "@/lib/api-client";

function Verification(): React.JSX.Element {
  const token = useSearchParams().get("token");
  const [message, setMessage] = useState("Verifying your email...");
  useEffect(() => {
    if (!token) {
      setMessage("Verification token is missing.");
      return;
    }
    void apiRequest("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }).then(
      () => setMessage("Email verified. You can sign in now."),
      (error: unknown) => setMessage(error instanceof Error ? error.message : "Verification failed"),
    );
  }, [token]);
  return <p className="mt-4 text-sm text-muted-foreground">{message}</p>;
}

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Email verification</h1>
      <Suspense fallback={<p className="mt-4">Loading...</p>}><Verification /></Suspense>
      <Link className="mt-6 inline-block text-sm text-emerald-300" href="/login">Return to sign in</Link>
    </section>
  );
}
