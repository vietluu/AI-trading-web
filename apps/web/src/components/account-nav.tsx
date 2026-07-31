import Link from "next/link";

const links = [
  ["Profile", "/profile"],
  ["Security", "/security"],
  ["Settings", "/settings"],
  ["API keys", "/api-keys"],
  ["Exchanges", "/settings/exchanges"],
] as const;

export function AccountNav(): React.JSX.Element {
  return (
    <nav className="mb-8 flex flex-wrap gap-2">
      {links.map(([label, href]) => (
        <Link
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          href={href}
          key={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
