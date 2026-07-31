import {
  apiErrorSchema,
  healthResponseSchema,
  type HealthResponse,
} from "@platform/shared";

import { publicEnvironment } from "./environment";

export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/api/health`,
    {
      headers: { Accept: "application/json" },
      signal: signal ?? null,
    },
  );
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
