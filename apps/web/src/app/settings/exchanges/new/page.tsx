"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ROUTES } from "@/constants/routes";
import { ExchangeConnectionForm } from "@/components/exchange-connection-form";

export default function NewExchangePage(): React.JSX.Element {
  const router = useRouter();
  return (
    <section>
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        href={ROUTES.settingsExchanges}
      >
        <ArrowLeft className="h-4 w-4" /> Connections
      </Link>
      <h1 className="text-3xl font-semibold">New exchange connection</h1>
      <p className="mb-8 mt-2 text-sm text-muted-foreground">
        The test only reads account data. It never places or changes orders.
      </p>
      <ExchangeConnectionForm
        onCreated={(id) => router.push(ROUTES.settingsExchangeDetail(id))}
      />
    </section>
  );
}
