import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

export const inputClass =
  "w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm outline-none focus:border-emerald-400";
export const buttonClass =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";

export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
}): React.JSX.Element {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
}): React.JSX.Element {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select className={inputClass} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Feedback({
  error,
  success,
}: {
  error?: string | undefined;
  success?: string | undefined;
}): React.JSX.Element | null {
  if (error)
    return (
      <p className="text-sm text-red-300" role="alert">
        {error}
      </p>
    );
  if (success) return <p className="text-sm text-emerald-300">{success}</p>;
  return null;
}
