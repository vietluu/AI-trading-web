import {
  apiErrorSchema,
  healthResponseSchema,
  type HealthResponse,
} from "@platform/shared";

import { resolveApiUrl } from "./api-client";
export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(resolveApiUrl("/health"), {
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  const body: unknown = await response.json();

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body);
    throw new Error(
      parsedError.success
        ? parsedError.data.message
        : `Health request failed with status ${response.status}`,
    );
  }

  return healthResponseSchema.parse(body);
}
