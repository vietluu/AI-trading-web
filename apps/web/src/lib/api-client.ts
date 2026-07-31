import { publicEnvironment } from "./environment";
import type { ZodType } from "zod";

export interface ApiErrorBody {
  message?: string | string[];
}

export async function apiRequestValidated<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  return schema.parse(await apiRequest<unknown>(path, init));
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/api${path}`,
    {
      ...init,
      credentials: "include",
      headers,
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    throw new Error(message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
