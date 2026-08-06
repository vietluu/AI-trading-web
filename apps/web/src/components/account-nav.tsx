"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";

export function AccountNav(): React.JSX.Element {
  const { t } = useTranslation();
  const pathname = usePathname();

  const navItems = [
    { label: t.accountNav.general, href: ROUTES.settings },
    { label: t.accountNav.exchanges, href: ROUTES.settingsExchanges },
    { label: t.accountNav.dataSources, href: ROUTES.dataSource },
    { label: t.accountNav.aiProviders, href: ROUTES.settingsAi },
    { label: t.accountNav.apiKeys, href: ROUTES.apiKeys },
    { label: t.accountNav.profile, href: ROUTES.profile },
    { label: t.accountNav.security, href: ROUTES.security },
  ];

  const isActive = (href: string): boolean => {
    if (href === ROUTES.settings) {
      return pathname === ROUTES.settings;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav
      aria-label="Settings navigation"
      className="mb-8 flex gap-2 overflow-x-auto pb-2"
    >
      {navItems.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-foreground hover:bg-muted"
            }`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
