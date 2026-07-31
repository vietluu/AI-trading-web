"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-xl py-24 text-center" role="alert">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">
        Dashboard error
      </p>
      <h1 className="mt-3 text-3xl font-semibold">The page could not load.</h1>
      <p className="mt-4 text-sm text-muted-foreground">{error.message}</p>
      <button
        className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        onClick={reset}
        type="button"
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}
