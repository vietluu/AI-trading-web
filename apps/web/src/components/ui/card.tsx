import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Card({
  className,
  ...properties
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-foreground shadow-sm",
        className,
      )}
      {...properties}
    />
  );
}

export function CardHeader({
  className,
  ...properties
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...properties}
    />
  );
}

export function CardTitle({
  className,
  ...properties
}: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return (
    <h2
      className={cn("text-base font-semibold tracking-tight", className)}
      {...properties}
    />
  );
}

export function CardContent({
  className,
  ...properties
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("p-6 pt-0", className)} {...properties} />;
}
