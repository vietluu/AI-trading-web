"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";

const primary = [
  ["Overview", "/"],
  ["Market", "/market"],
  ["Decision", "/ai/decision"],
  ["Automation", "/ai/pipeline"],
  ["Trading", "/ai/live-trading"],
] as const;

const more = [
  ["News", "/news"],
  ["Macro", "/macro"],
  ["Sentiment", "/sentiment"],
  ["Agent runs", "/ai/agent-runs"],
  ["Performance", "/ai/performance"],
  ["Risk", "/ai/risk"],
  ["Portfolio", "/ai/portfolio"],
] as const;

export function AppNavigation(): React.JSX.Element {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
 async function logout(): Promise<void> {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      router.push("/login");
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

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

      {/* Navigation container */}
      <nav
        aria-label="Main navigation"
        className={` ${
          mobileMenuOpen
            ? "absolute left-0 right-0 top-full z-50 mt-2 flex flex-col gap-1 rounded-2xl border border-border bg-background p-4 shadow-2xl lg:static lg:z-auto lg:mt-0 lg:flex-row lg:items-center lg:border-none lg:bg-transparent lg:p-0 lg:shadow-none"
            : "hidden lg:flex lg:items-center lg:gap-1"
        }`}
      >
         {primary.map(([label, href]) => (
          <Link
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active(href)
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            href={href}
            key={href}
            onClick={() => {
              setDropdownOpen(false);
              setMobileMenuOpen(false);
            }}
          >
            {label}
          </Link>
        ))}

        {/* Stateful Insights Dropdown */}
        <div className="relative w-fit" ref={dropdownRef}>
          <button
            aria-expanded={dropdownOpen}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDropdownOpen((prev) => !prev)}
            type="button"
          >
            <span>Insights</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                dropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {dropdownOpen && (
            <div className="z-50 w-fit mt-1 grid w-52 gap-1 rounded-xl border border-border bg-card p-2 shadow-2xl lg:absolute lg:right-0 lg:mt-2">
              {more.map(([label, href]) => (
                <Link
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                    active(href)
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  href={href}
                  key={href}
                  onClick={() => {
                    setDropdownOpen(false);
                    setMobileMenuOpen(false);
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <Link
          aria-label="Settings"
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            pathname.startsWith("/settings") ||
            pathname === "/profile" ||
            pathname === "/security" ||
            pathname === "/api-keys"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          href="/settings"
          onClick={() => {
            setDropdownOpen(false);
            setMobileMenuOpen(false);
          }}
        >
          Settings
        </Link>
        <button
          className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          key="logout"
          onClick={(event) => {
            event.preventDefault();
            setDropdownOpen(false);
            setMobileMenuOpen(false);
            void logout();
          }}
          type="button"
        >
          Log out
        </button>
      </nav>
    </div>
  );
}

