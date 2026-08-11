"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Globe, Menu, X } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { MORE_NAV_ITEMS, PRIMARY_NAV_ITEMS } from "@/constants/navigation.constants";
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
    setLanguage(language === 'en' ? 'vi' : 'en');
  };

  return (
    <div className="relative w-full flex justify-end">
      {/* Mobile menu button */}
      <button
        aria-label="Toggle Navigation"
        className="flex items-center justify-center rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        onClick={() => setMobileMenuOpen((prev) => !prev)}
        type="button"
      >
        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile Navigation Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Navigation container */}
      <nav
        aria-label="Main navigation"
        className={` ${
          mobileMenuOpen
            ? "fixed inset-x-4 top-16 z-[99] flex flex-col gap-1.5 rounded-2xl border border-border bg-card/95 backdrop-blur-xl p-4 shadow-2xl max-h-[80vh] overflow-y-auto lg:static lg:z-auto lg:top-auto lg:inset-auto lg:max-h-none lg:overflow-visible lg:flex-row lg:items-center lg:border-none lg:bg-transparent lg:p-0 lg:shadow-none"
            : "hidden lg:flex lg:items-center lg:gap-1"
        }`}
      >
        {PRIMARY_NAV_ITEMS.map((item) => (
          <Link
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active(item.href)
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
            {t.nav[item.key]}
          </Link>
        ))}

        {/* Stateful Insights Dropdown */}
        <div className="relative w-full lg:w-fit" ref={dropdownRef}>
          <button
            aria-expanded={dropdownOpen}
            className="flex w-full items-center justify-between lg:justify-start gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDropdownOpen((prev) => !prev)}
            type="button"
          >
            <span>{t.nav.insights}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                dropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {dropdownOpen && (
            <div className="z-[99] mt-1 grid w-full gap-1 rounded-xl border border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur-xl lg:absolute lg:right-0 lg:mt-2 lg:w-[28rem] lg:grid-cols-2 lg:bg-card">
              {MORE_NAV_ITEMS.map((item) => (
                <Link
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                    active(item.href)
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
                  {t.nav[item.key]}
                </Link>
              ))}
            </div>
          )}
        </div>

        <Link
          aria-label={t.nav.settings}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            pathname.startsWith("/settings") ||
            pathname === "/profile" ||
            pathname === "/security" ||
            pathname === "/api-keys"
              ? "bg-primary/15 text-primary font-semibold"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          href={ROUTES.settings}
          onClick={() => {
            setDropdownOpen(false);
            setMobileMenuOpen(false);
          }}
        >
          {t.nav.settings}
        </Link>

        {/* Language Switcher */}
        <button
          aria-label="Toggle language"
          className="flex items-center gap-1.5 w-full lg:w-auto whitespace-nowrap rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={toggleLanguage}
          title={language === 'en' ? 'Chuyển sang Tiếng Việt' : 'Switch to English'}
          type="button"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{language === 'en' ? 'English (EN)' : 'Tiếng Việt (VI)'}</span>
        </button>

        <button
          className="w-full lg:w-auto text-left whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
          key="logout"
          onClick={(event) => {
            event.preventDefault();
            setDropdownOpen(false);
            setMobileMenuOpen(false);
            void handleLogout();
          }}
          type="button"
        >
          {t.nav.logout}
        </button>
      </nav>
    </div>
  );
}
