import Link from "next/link";

const links = [
  ["General", "/settings"],
  ["Exchanges", "/settings/exchanges"],
  ["Data sources", "/settings/data-sources"],
  ["AI providers", "/settings/ai"],
  ["API keys", "/api-keys"],
  ["Profile", "/profile"],
  ["Security", "/security"],
] as const;

export function AccountNav(): React.JSX.Element {
  return (
    <nav
      aria-label="Settings navigation"
      className="mb-8 flex gap-2 overflow-x-auto pb-2"
    >
      {links.map(([label, href]) => (
        <Link
          className="whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          href={href}
          key={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
