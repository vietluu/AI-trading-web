import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthStatus } from "../src/components/health-status";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HealthStatus", () => {
  it("renders validated dependency health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ok",
            timestamp: "2026-07-31T00:00:00.000Z",
            services: {
              database: { status: "up", latencyMs: 3 },
              redis: { status: "up", latencyMs: 1 },
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <HealthStatus />
      </QueryClientProvider>,
    );

    expect(
      screen.getByText("Checking API, PostgreSQL, and Redis…"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Platform operational")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
  });
});
