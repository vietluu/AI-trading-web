import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import { ExchangeError, ExchangeErrorCode } from "../../domain/exchange.error";
import {
  ExchangeEnvironment,
  ExchangeProvider,
  type ExchangeCredentials,
} from "../../domain/exchange.types";
import { ExchangeHttpService } from "../exchange-http.service";
import { ExchangeTimeService } from "../exchange-time.service";
import { OkxSignatureService } from "./okx-signature.service";

const timeEnvelopeSchema = z.object({
  code: z.string(),
  data: z.array(z.object({ ts: z.string().regex(/^\d+$/) })).min(1),
});

@Injectable()
export class OkxFuturesClient {
  private readonly baseUrl: string;
  private readonly provider = ExchangeProvider.OKX_FUTURES;

  constructor(
    private readonly http: ExchangeHttpService,
    private readonly signatures: OkxSignatureService,
    private readonly time: ExchangeTimeService,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>("OKX_BASE_URL");
  }

  async publicGet(
    path: string,
    parameters: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    const requestPath = this.path(path, parameters);
    const response = await this.http.request({
      provider: this.provider,
      operation: path,
      url: `${this.baseUrl}${requestPath}`,
    });
    return this.unwrap(response.data, response.correlationId);
  }

  async signedGet(
    path: string,
    credentials: ExchangeCredentials,
    parameters: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    try {
      return await this.signedGetOnce(path, credentials, parameters);
    } catch (caught) {
      if (
        !(caught instanceof ExchangeError) ||
        caught.code !== ExchangeErrorCode.TIMESTAMP_INVALID
      )
        throw caught;
      await this.time.invalidate(this.provider, credentials.environment);
      return this.signedGetOnce(path, credentials, parameters);
    }
  }

  async signedPost(
    path: string,
    credentials: ExchangeCredentials,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.signedWrite("POST", path, credentials, body);
  }

  async serverTime(): Promise<number> {
    const response = timeEnvelopeSchema.parse(
      await this.http
        .request({
          provider: this.provider,
          operation: "/api/v5/public/time",
          url: `${this.baseUrl}/api/v5/public/time`,
        })
        .then((result) => result.data),
    );
    return Number(response.data[0]!.ts);
  }

  private async signedGetOnce(
    path: string,
    credentials: ExchangeCredentials,
    parameters: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    if (credentials.environment === ExchangeEnvironment.TESTNET) {
      throw ExchangeError.invalidRequest(
        this.provider,
        "OKX Futures uses DEMO instead of TESTNET",
      );
    }
    const offset = await this.time.offset(
      this.provider,
      credentials.environment,
      () => this.serverTime(),
    );
    const requestPath = this.path(path, parameters);
    const timestamp = new Date(Date.now() + offset).toISOString();
    const response = await this.http.request({
      provider: this.provider,
      operation: path,
      url: `${this.baseUrl}${requestPath}`,
      init: {
        headers: {
          "OK-ACCESS-KEY": credentials.apiKey,
          "OK-ACCESS-PASSPHRASE": credentials.passphrase ?? "",
          "OK-ACCESS-SIGN": this.signatures.sign(
            timestamp,
            "GET",
            requestPath,
            "",
            credentials.apiSecret,
          ),
          "OK-ACCESS-TIMESTAMP": timestamp,
          ...(credentials.environment === ExchangeEnvironment.DEMO
            ? { "x-simulated-trading": "1" }
            : {}),
        },
      },
    });
    return this.unwrap(response.data, response.correlationId);
  }

  private async signedWrite(
    method: "POST",
    path: string,
    credentials: ExchangeCredentials,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    if (credentials.environment === ExchangeEnvironment.TESTNET) {
      throw ExchangeError.invalidRequest(this.provider, "OKX Futures uses DEMO instead of TESTNET");
    }
    const offset = await this.time.offset(
      this.provider,
      credentials.environment,
      () => this.serverTime(),
    );
    const timestamp = new Date(Date.now() + offset).toISOString();
    const serialized = JSON.stringify(body);
    const response = await this.http.request({
      provider: this.provider,
      operation: path,
      url: `${this.baseUrl}${path}`,
      init: {
        method,
        headers: {
          "Content-Type": "application/json",
          "OK-ACCESS-KEY": credentials.apiKey,
          "OK-ACCESS-PASSPHRASE": credentials.passphrase ?? "",
          "OK-ACCESS-SIGN": this.signatures.sign(timestamp, method, path, serialized, credentials.apiSecret),
          "OK-ACCESS-TIMESTAMP": timestamp,
          ...(credentials.environment === ExchangeEnvironment.DEMO ? { "x-simulated-trading": "1" } : {}),
        },
        body: serialized,
      },
      retryable: false,
    });
    return this.unwrap(response.data, response.correlationId);
  }

  private path(
    path: string,
    parameters: Record<string, string | number | undefined>,
  ): string {
    const query = new URLSearchParams();
    for (const key of Object.keys(parameters).sort()) {
      const value = parameters[key];
      if (value !== undefined) query.set(key, String(value));
    }
    return `${path}${query.size ? `?${query.toString()}` : ""}`;
  }

  private unwrap(value: unknown, correlationId?: string): unknown {
    if (!value || typeof value !== "object" || !("code" in value)) {
      throw new ExchangeError(
        ExchangeErrorCode.UNKNOWN,
        this.provider,
        false,
        502,
        "Unexpected OKX response",
        undefined,
        correlationId,
      );
    }
    const envelope = value as {
      code: unknown;
      data?: unknown;
      msg?: unknown;
    };
    if (envelope.code !== "0") {
      const code =
        typeof envelope.code === "string" || typeof envelope.code === "number"
          ? String(envelope.code)
          : undefined;
      const message = this.extractOrderMessage(envelope.data, envelope.msg);
      throw this.okxError(code, correlationId, message);
    }
    return envelope.data;
  }

  private extractOrderMessage(data: unknown, fallback?: unknown): string | undefined {
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] as unknown;
      if (first && typeof first === "object") {
        const candidate = first as { sMsg?: unknown; msg?: unknown };
        if (typeof candidate.sMsg === "string" && candidate.sMsg.trim()) {
          return candidate.sMsg;
        }
        if (typeof candidate.msg === "string" && candidate.msg.trim()) {
          return candidate.msg;
        }
      }
    }
    if (typeof fallback === "string" && fallback.trim()) {
      return fallback;
    }
    return undefined;
  }

  private okxError(
    code?: string,
    correlationId?: string,
    message?: string,
  ): ExchangeError {
    if (code === "50102")
      return new ExchangeError(
        ExchangeErrorCode.TIMESTAMP_INVALID,
        this.provider,
        true,
        400,
        "Exchange timestamp is outside the accepted window",
        code,
        correlationId,
      );
    if (code === "50111" || code === "50112")
      return new ExchangeError(
        ExchangeErrorCode.INVALID_CREDENTIALS,
        this.provider,
        false,
        401,
        "Exchange credentials are invalid",
        code,
        correlationId,
      );
    if (code === "50113")
      return new ExchangeError(
        ExchangeErrorCode.INVALID_SIGNATURE,
        this.provider,
        false,
        401,
        "Exchange signature is invalid",
        code,
        correlationId,
      );
    if (code === "51001" || code === "51008")
      return new ExchangeError(
        ExchangeErrorCode.INVALID_SYMBOL,
        this.provider,
        false,
        400,
        "Exchange symbol is invalid or unavailable",
        code,
        correlationId,
      );
    if (code === "1") {
      return new ExchangeError(
        ExchangeErrorCode.INVALID_REQUEST,
        this.provider,
        false,
        400,
        message ?? "OKX rejected the request",
        code,
        correlationId,
      );
    }
    if (
      [
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
      ].includes(code ?? "")
    ) {
      return new ExchangeError(
        ExchangeErrorCode.INVALID_REQUEST,
        this.provider,
        false,
        400,
        message ?? "OKX rejected the request",
        code,
        correlationId,
      );
    }
    return new ExchangeError(
      ExchangeErrorCode.UNKNOWN,
      this.provider,
      false,
      502,
      message ?? "OKX rejected the request",
      code,
      correlationId,
    );
  }
}
