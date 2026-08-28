"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Globe,
  Menu,
  X,
  Sparkles,
  BarChart3,
  ShieldAlert,
  Sliders,
  LogOut,
  Layers,
  FlaskConical,
  Newspaper,
  Brain,
  Gauge,
  History,
  Activity,
  Award,
  PieChart,
  Bot,
} from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { PRIMARY_NAV_ITEMS } from "@/constants/navigation.constants";
import { logout as logoutUser } from "@/services/auth.service";

export function AppNavigation(): React.JSX.Element {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { language, setLanguage, t } = useTranslation();

  async function handleLogout(): Promise<void> {
    try {
      await logoutUser();
      router.push(ROUTES.login);
    } catch (caught) {
      console.error(caught instanceof Error ? caught.message : "Logout failed");
    }
  }

  const active = (href: string) =>
    href === "/" ? pathname === href : pathname.startsWith(href);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Close menus on route change
  useEffect(() => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  const toggleLanguage = () => {
    setLanguage(language === "en" ? "vi" : "en");
  };

  const navCategories = [
    {
      title: language === "vi" ? "Nghiên cứu & Chiến lược" : "Research & Strategy",
      items: [
        { key: "research" as const, href: ROUTES.research, icon: FlaskConical },
        { key: "factors" as const, href: ROUTES.factors, icon: Layers },
        { key: "strategyLab" as const, href: ROUTES.strategyLab, icon: Sliders },
        { key: "portfolioIntelligence" as const, href: ROUTES.portfolioIntelligence, icon: PieChart },
        { key: "recommendations" as const, href: ROUTES.recommendations, icon: Sparkles },
        { key: "knowledge" as const, href: ROUTES.knowledge, icon: Brain },
      ],
    },
    {
      title: language === "vi" ? "Dữ liệu & AI Agent" : "Data & AI Intelligence",
      items: [
        { key: "news" as const, href: ROUTES.news, icon: Newspaper },
        { key: "macro" as const, href: ROUTES.macro, icon: BarChart3 },
        { key: "sentiment" as const, href: ROUTES.sentiment, icon: Gauge },
        { key: "agentRuns" as const, href: ROUTES.ai.agentRuns, icon: Bot },
        { key: "diagnostic" as const, href: ROUTES.ai.diagnostic, icon: Activity },
      ],
    },
    {
      title: language === "vi" ? "Vận hành & Rủi ro" : "Operations & Risk",
      items: [
        { key: "pipelineRuns" as const, href: ROUTES.ai.pipelineRuns, icon: History },
        { key: "reflection" as const, href: ROUTES.ai.reflection, icon: Sparkles },
        { key: "performance" as const, href: ROUTES.ai.performance, icon: Award },
        { key: "risk" as const, href: ROUTES.ai.risk, icon: ShieldAlert },
        { key: "portfolio" as const, href: ROUTES.ai.portfolio, icon: PieChart },
      ],
    },
  ];

  const isMoreActive = navCategories.some((cat) =>
    cat.items.some((item) => active(item.href)),
  );

  return (
    <div className="relative flex w-full justify-end items-center">
      {/* Mobile menu button */}
      <button
        aria-label="Toggle Navigation"
        className="flex items-center justify-center rounded-xl border border-border bg-card/60 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground lg:hidden"
        onClick={() => setMobileMenuOpen((prev) => !prev)}
        type="button"
      >
        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile Navigation Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Navigation container */}
      <nav
        aria-label="Main navigation"
        className={`${
          mobileMenuOpen
            ? "fixed inset-x-4 top-20 z-[99] flex flex-col gap-3 rounded-2xl border border-border bg-card/95 p-5 shadow-2xl backdrop-blur-2xl max-h-[80vh] overflow-y-auto lg:static lg:z-auto lg:top-auto lg:inset-auto lg:max-h-none lg:overflow-visible lg:flex-row lg:items-center lg:border-none lg:bg-transparent lg:p-0 lg:shadow-none"
            : "hidden lg:flex lg:items-center lg:gap-1.5"
        }`}
      >
        {/* Primary nav items */}
        {PRIMARY_NAV_ITEMS.map((item) => (
          <Link
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              active(item.href)
                ? "bg-primary/15 text-primary font-semibold shadow-xs"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
            href={item.href}
            key={item.href}
            onClick={() => {
              setDropdownOpen(false);
              setMobileMenuOpen(false);
            }}
          >
            {t.nav[item.key]}
          </Link>
        ))}

        {/* Stateful Categorized Explore Dropdown */}
        <div className="relative w-full lg:w-fit" ref={dropdownRef}>
          <button
            aria-expanded={dropdownOpen}
            className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all lg:w-auto lg:justify-start ${
              isMoreActive || dropdownOpen
                ? "bg-primary/15 text-primary font-semibold"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
            onClick={() => setDropdownOpen((prev) => !prev)}
            type="button"
          >
            <span>{t.nav.insights}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                dropdownOpen ? "rotate-180 text-primary" : "text-muted-foreground"
              }`}
            />
          </button>

          {dropdownOpen && (
            <div className="z-[99] mt-2 w-full rounded-2xl border border-border/80 bg-card/95 p-4 shadow-2xl backdrop-blur-2xl lg:absolute lg:right-0 lg:mt-3 lg:w-[42rem] lg:grid lg:grid-cols-3 lg:gap-4">
              {navCategories.map((category) => (
                <div key={category.title} className="space-y-1.5 py-1">
                  <p className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                    {category.title}
                  </p>
                  <div className="space-y-0.5">
                    {category.items.map((item) => {
                      const Icon = item.icon;
                      const isItemActive = active(item.href);
                      return (
                        <Link
                          className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-all ${
                            isItemActive
                              ? "bg-primary/15 text-primary font-semibold"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                          href={item.href}
                          key={item.href}
                          onClick={() => {
                            setDropdownOpen(false);
                            setMobileMenuOpen(false);
                          }}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${isItemActive ? "text-primary" : "text-muted-foreground/60"}`} />
                          <span className="truncate">{t.nav[item.key]}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settings nav link */}
        <Link
          aria-label={t.nav.settings}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all ${
            pathname.startsWith("/settings") ||
            pathname === "/profile" ||
            pathname === "/security" ||
            pathname === "/api-keys"
              ? "bg-primary/15 text-primary font-semibold shadow-xs"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
          href={ROUTES.settings}
          onClick={() => {
            setDropdownOpen(false);
            setMobileMenuOpen(false);
          }}
        >
          {t.nav.settings}
        </Link>

        {/* Language Switcher Pill */}
        <button
          aria-label="Toggle language"
          className="flex items-center gap-1.5 w-full lg:w-auto whitespace-nowrap rounded-xl border border-border/80 bg-card/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/40 hover:bg-muted hover:text-foreground"
          onClick={toggleLanguage}
          title={language === "en" ? "Chuyển sang Tiếng Việt" : "Switch to English"}
          type="button"
        >
          <Globe className="h-3.5 w-3.5 text-primary" />
          <span className="tracking-wide">
            <span className={language === "en" ? "text-primary font-bold" : "opacity-60"}>EN</span>
            <span className="mx-1 opacity-40">|</span>
            <span className={language === "vi" ? "text-primary font-bold" : "opacity-60"}>VI</span>
          </span>
        </button>

        {/* Logout button */}
        <button
          className="flex items-center gap-1.5 w-full lg:w-auto whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-all"
          key="logout"
          onClick={(event) => {
            event.preventDefault();
            setDropdownOpen(false);
            setMobileMenuOpen(false);
            void handleLogout();
          }}
          type="button"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>{t.nav.logout}</span>
        </button>
      </nav>
    </div>
  );
}
