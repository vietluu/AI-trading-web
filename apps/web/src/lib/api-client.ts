import { publicEnvironment } from "./environment";
import type { ZodType } from "zod";

interface ApiErrorToastDetail {
  message: string;
  status: number;
}

export interface ApiErrorBody {
  message?: string | string[];
  error?: string;
  code?: string;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequestValidated<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  return schema.parse(await apiRequest<unknown>(path, init));
}

export function resolveApiUrl(path: string): string {
  let baseUrl = publicEnvironment.NEXT_PUBLIC_API_BASE_URL.trim().replace(
    /\/$/,
    "",
  );
  if (baseUrl.endsWith("/api")) {
    baseUrl = baseUrl.slice(0, -4);
  }
  const normalizedPath = path.startsWith("/api")
    ? path
    : `/api${path.startsWith("/") ? path : `/${path}`}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export function hasAuthSessionHint(): boolean {
  return Boolean(readCookie("csrf_token"));
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init?.method ?? "GET").toUpperCase();
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !headers.has("X-CSRF-Token")
  ) {
    const csrfToken = readCookie("csrf_token");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(resolveApiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    const error = new ApiRequestError(
      message ?? `Request failed (${response.status})`,
      response.status,
    );
    const isExchangeError =
      (typeof body.error === "string" && body.error.startsWith("EXCHANGE_")) ||
      (typeof body.code === "string" && body.code.startsWith("EXCHANGE_"));
    const isAuthenticationFailure = response.status === 401 && !isExchangeError;

    if (
      isAuthenticationFailure &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }

    // An unauthenticated response is an expected control-flow event: protected
    // pages redirect to login and login forms render their own inline error.
    // Emitting a global toast here causes noisy "Authentication required"
    // messages on logout or when a session naturally expires.
    if (typeof window !== "undefined" && !isAuthenticationFailure) {
      window.dispatchEvent(
        new CustomEvent<ApiErrorToastDetail>("api:error", {
          detail: { message: error.message, status: error.status },
        }),
      );
    }

    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}
