import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ExchangeError, ExchangeErrorCode } from "../domain/exchange.error";
import { ExchangeProvider } from "../domain/exchange.types";

export interface ExchangeHttpRequest {
  provider: ExchangeProvider;
  operation: string;
  url: string;
  init?: RequestInit;
  correlationId?: string;
  retryable?: boolean;
}

export interface ExchangeHttpResponse {
  data: unknown;
  headers: Headers;
  correlationId: string;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

@Injectable()
export class ExchangeHttpService {
  private readonly logger = new Logger(ExchangeHttpService.name);
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>("EXCHANGE_HTTP_TIMEOUT_MS") ?? 10_000;
    this.maxRetries = config.get<number>("EXCHANGE_MAX_RETRIES") ?? 2;
    this.retryBaseDelayMs =
      config.get<number>("EXCHANGE_RETRY_BASE_DELAY_MS") ?? 300;
  }

  async request(request: ExchangeHttpRequest): Promise<ExchangeHttpResponse> {
    const correlationId = request.correlationId ?? randomUUID();
    const startedAt = Date.now();
    let retryCount = 0;
    while (true) {
      try {
        const response = await fetch(request.url, {
          ...request.init,
          headers: {
            Accept: "application/json",
            ...request.init?.headers,
            "X-Correlation-Id": correlationId,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const error = this.httpError(
            request.provider,
            response.status,
            correlationId,
            data,
          );
          if (request.retryable !== false && retryCount < this.maxRetries && error.retryable) {
            await this.backoff(
              retryCount++,
              response.headers.get("retry-after"),
            );
            continue;
          }
          throw error;
        }
        this.logger.log({
          event: "exchange_request",
          provider: request.provider,
          operation: request.operation,
          durationMs: Date.now() - startedAt,
          status: "success",
          retryCount,
          correlationId,
        });
        return { data, headers: response.headers, correlationId };
      } catch (caught) {
        if (caught instanceof ExchangeError) {
          this.logFailure(request, caught, startedAt, retryCount);
          throw caught;
        }
        const timedOut =
          caught instanceof Error && caught.name === "TimeoutError";
        const error = new ExchangeError(
          timedOut ? ExchangeErrorCode.TIMEOUT : ExchangeErrorCode.UNAVAILABLE,
          request.provider,
          true,
          timedOut ? 504 : 503,
          timedOut
            ? "Exchange request timed out"
            : "Exchange is temporarily unavailable",
          undefined,
          correlationId,
        );
        if (request.retryable !== false && retryCount < this.maxRetries) {
          await this.backoff(retryCount++);
          continue;
        }
        this.logFailure(request, error, startedAt, retryCount);
        throw error;
      }
    }
  }

  private httpError(
    provider: ExchangeProvider,
    status: number,
    correlationId: string,
    body: unknown,
  ): ExchangeError {
    const exchangeCode = this.exchangeCode(body);
    const message = this.exchangeMessage(body);
    const vendorCode = this.vendorCode(provider, exchangeCode);
    if (vendorCode) {
      return new ExchangeError(
        vendorCode.code,
        provider,
        vendorCode.retryable,
        vendorCode.statusCode,
        message ?? vendorCode.message,
        exchangeCode,
        correlationId,
      );
    }
    if (status === 429) {
      return new ExchangeError(
        ExchangeErrorCode.RATE_LIMITED,
        provider,
        true,
        429,
        message ?? "Exchange rate limit exceeded",
        undefined,
        correlationId,
      );
    }
    if (status === 401) {
      return new ExchangeError(
        ExchangeErrorCode.AUTHENTICATION_FAILED,
        provider,
        false,
        401,
        message ?? "Exchange authentication failed",
        undefined,
        correlationId,
      );
    }
    if (status === 403) {
      return new ExchangeError(
        ExchangeErrorCode.PERMISSION_DENIED,
        provider,
        false,
        403,
        message ?? "Exchange permission denied",
        undefined,
        correlationId,
      );
    }
    return new ExchangeError(
      status === 404
        ? ExchangeErrorCode.RESOURCE_NOT_FOUND
        : ExchangeErrorCode.UNAVAILABLE,
      provider,
      isRetryableStatus(status),
      status >= 500 ? 503 : status,
      message ??
        (status === 404
          ? "Exchange resource not found"
          : "Exchange request failed"),
      undefined,
      correlationId,
    );
  }

  private exchangeCode(body: unknown): string | undefined {
    if (!body || typeof body !== "object") return undefined;
    const value = "code" in body ? body.code : undefined;
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : undefined;
  }

  private exchangeMessage(body: unknown): string | undefined {
    if (!body || typeof body !== "object") return undefined;
    const value = "msg" in body ? body.msg : undefined;
    return typeof value === "string" ? value : undefined;
  }

  private vendorCode(
    provider: ExchangeProvider,
    code?: string,
  ):
    | {
        code: ExchangeErrorCode;
        retryable: boolean;
        statusCode: number;
        message: string;
      }
    | undefined {
    if (!code) return undefined;
    const timestampCodes =
      provider === ExchangeProvider.BINANCE_FUTURES ? ["-1021"] : ["50102"];
    const signatureCodes =
      provider === ExchangeProvider.BINANCE_FUTURES ? ["-1022"] : ["50113"];
    const credentialCodes =
      provider === ExchangeProvider.BINANCE_FUTURES
        ? ["-2014", "-2015"]
        : ["50111", "50112"];
    const symbolCodes =
      provider === ExchangeProvider.BINANCE_FUTURES
        ? ["-1121"]
        : ["51001", "51008"];
    const invalidRequestCodes =
      provider === ExchangeProvider.BINANCE_FUTURES
        ? ["-2010", "-2011", "-2013", "-2014", "-2015"]
        : [
            "50004",
            "51000",
            "51002",
            "51003",
            "51004",
            "51005",
            "51006",
            "51009",
            "51010",
            "51011",
            "51012",
            "51013",
            "51014",
            "51015",
            "51016",
            "51017",
            "51018",
            "51019",
          ];
    if (timestampCodes.includes(code)) {
      return {
        code: ExchangeErrorCode.TIMESTAMP_INVALID,
        retryable: false,
        statusCode: 400,
        message: "Exchange timestamp is outside the accepted window",
      };
    }
    if (signatureCodes.includes(code)) {
      return {
        code: ExchangeErrorCode.INVALID_SIGNATURE,
        retryable: false,
        statusCode: 401,
        message: "Exchange signature is invalid",
      };
    }
    if (credentialCodes.includes(code)) {
      return {
        code: ExchangeErrorCode.INVALID_CREDENTIALS,
        retryable: false,
        statusCode: 401,
        message: "Exchange credentials are invalid",
      };
    }
    if (symbolCodes.includes(code)) {
      return {
        code: ExchangeErrorCode.INVALID_SYMBOL,
        retryable: false,
        statusCode: 400,
        message: "Exchange symbol is invalid or unavailable",
      };
    }
    if (invalidRequestCodes.includes(code)) {
      return {
        code: ExchangeErrorCode.INVALID_REQUEST,
        retryable: false,
        statusCode: 400,
        message: "Exchange rejected the request",
      };
    }
    return undefined;
  }

  private async backoff(
    attempt: number,
    retryAfter?: string | null,
  ): Promise<void> {
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jitter = Math.floor(
      Math.random() * Math.max(1, this.retryBaseDelayMs / 2),
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(retryAfterMs, exponential + jitter)),
    );
  }

  private logFailure(
    request: ExchangeHttpRequest,
    error: ExchangeError,
    startedAt: number,
    retryCount: number,
  ): void {
    this.logger.warn({
      event: "exchange_request",
      provider: request.provider,
      operation: request.operation,
      durationMs: Date.now() - startedAt,
      status: "failed",
      normalizedErrorCode: error.code,
      retryCount,
      correlationId: error.correlationId,
    });
  }
}
