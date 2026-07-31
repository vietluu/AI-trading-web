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
    const envelope = value as { code: unknown; data?: unknown };
    if (envelope.code !== "0") {
      const code =
        typeof envelope.code === "string" ? envelope.code : undefined;
      throw this.okxError(code, correlationId);
    }
    return envelope.data;
  }

  private okxError(code?: string, correlationId?: string): ExchangeError {
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
    return new ExchangeError(
      ExchangeErrorCode.UNKNOWN,
      this.provider,
      false,
      502,
      "OKX rejected the request",
      code,
      correlationId,
    );
  }
}
