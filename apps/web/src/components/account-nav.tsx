"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/i18n/i18n-context";

export function AccountNav(): React.JSX.Element {
  const { t } = useTranslation();

  const navItems = [
    { label: t.nav.settings, href: "/settings" },
    { label: t.accountNav.apiKeys, href: "/api-keys" },
    { label: t.accountNav.profile, href: "/profile" },
    { label: t.accountNav.security, href: "/security" },
  ];

  return (
    <nav
      aria-label="Settings navigation"
      className="mb-8 flex gap-2 overflow-x-auto pb-2"
    >
      {navItems.map((item) => (
        <Link
          className="whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted font-medium"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
