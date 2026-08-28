"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sliders,
  Landmark,
  Database,
  Bot,
  KeyRound,
  User,
  ShieldCheck,
} from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";

export function AccountNav(): React.JSX.Element {
  const { t } = useTranslation();
  const pathname = usePathname();

  const navItems = [
    { label: t.accountNav.general, href: ROUTES.settings, icon: Sliders },
    { label: t.accountNav.exchanges, href: ROUTES.settingsExchanges, icon: Landmark },
    { label: t.accountNav.dataSources, href: ROUTES.dataSource, icon: Database },
    { label: t.accountNav.aiProviders, href: ROUTES.settingsAi, icon: Bot },
    { label: t.accountNav.apiKeys, href: ROUTES.apiKeys, icon: KeyRound },
    { label: t.accountNav.profile, href: ROUTES.profile, icon: User },
    { label: t.accountNav.security, href: ROUTES.security, icon: ShieldCheck },
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
      className="mb-8 flex gap-2 overflow-x-auto pb-2 scrollbar-none"
    >
      {navItems.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
              active
                ? "border-primary/50 bg-primary/15 text-primary shadow-xs"
                : "border-border/80 bg-card/60 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
            }`}
            href={item.href}
            key={item.href}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? "text-primary" : "text-muted-foreground/70"}`} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

