"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type PropsWithChildren } from "react";
import { toast, Toaster } from "sonner";

export function QueryProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 15_000,
          },
        },
      }),
  );

  useEffect(() => {
    const handleApiError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; status?: number }>).detail;
      if (!detail?.message) return;

      toast.error('Error', {
        description: detail.message ?? undefined,
      });
    };

    window.addEventListener("api:error", handleApiError);
    return () => {
      window.removeEventListener("api:error", handleApiError);
    };
  }, []);

  return (
    <>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
