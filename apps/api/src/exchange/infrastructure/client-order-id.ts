export function normalizeClientOrderId(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const withoutHyphens = trimmed.replace(/-/g, "");
  const alphanumeric = withoutHyphens.replace(/[^A-Za-z0-9]/g, "");

  if (!alphanumeric) return undefined;
  if (alphanumeric.length <= 32) return alphanumeric;

  return `${alphanumeric.slice(0, 30)}${alphanumeric.slice(-2)}`;
}
