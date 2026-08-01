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
import { BinanceSignatureService } from "./binance-signature.service";

const timeSchema = z.object({ serverTime: z.number().int() });

@Injectable()
export class BinanceFuturesClient {
  private readonly productionUrl: string;
  private readonly testnetUrl: string;

  constructor(
    private readonly http: ExchangeHttpService,
    private readonly signatures: BinanceSignatureService,
    private readonly time: ExchangeTimeService,
    config: ConfigService,
  ) {
    this.productionUrl = config.getOrThrow<string>("BINANCE_FUTURES_BASE_URL");
    this.testnetUrl = config.getOrThrow<string>(
      "BINANCE_FUTURES_TESTNET_BASE_URL",
    );
  }

  async publicGet(
    path: string,
    parameters: Record<string, string | number | undefined> = {},
    environment = ExchangeEnvironment.PRODUCTION,
  ): Promise<unknown> {
    const query = this.signatures.query(parameters);
    const response = await this.http.request({
      provider: ExchangeProvider.BINANCE_FUTURES,
      operation: path,
      url: `${this.baseUrl(environment)}${path}${query ? `?${query}` : ""}`,
    });
    return response.data;
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
    parameters: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    return this.signedWrite("POST", path, credentials, parameters);
  }

  async signedDelete(
    path: string,
    credentials: ExchangeCredentials,
    parameters: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    return this.signedWrite("DELETE", path, credentials, parameters);
  }

  async serverTime(
    environment = ExchangeEnvironment.PRODUCTION,
  ): Promise<number> {
    return timeSchema.parse(
      await this.publicGet("/fapi/v1/time", {}, environment),
    ).serverTime;
  }

  private async signedGetOnce(
    path: string,
    credentials: ExchangeCredentials,
    parameters: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const offset = await this.time.offset(
      this.provider,
      credentials.environment,
      () => this.serverTime(credentials.environment),
    );
    const query = this.signatures.query({
      ...parameters,
      recvWindow: 5000,
      timestamp: Date.now() + offset,
    });
    const signature = this.signatures.sign(query, credentials.apiSecret);
    const response = await this.http.request({
      provider: this.provider,
      operation: path,
      url: `${this.baseUrl(credentials.environment)}${path}?${query}&signature=${signature}`,
      init: { headers: { "X-MBX-APIKEY": credentials.apiKey } },
    });
    return response.data;
  }

  private async signedWrite(
    method: "POST" | "DELETE",
    path: string,
    credentials: ExchangeCredentials,
    parameters: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    const offset = await this.time.offset(
      this.provider,
      credentials.environment,
      () => this.serverTime(credentials.environment),
    );
    const query = this.signatures.query({
      ...parameters,
      recvWindow: 5000,
      timestamp: Date.now() + offset,
    });
    const signature = this.signatures.sign(query, credentials.apiSecret);
    const response = await this.http.request({
      provider: this.provider,
      operation: path,
      url: `${this.baseUrl(credentials.environment)}${path}?${query}&signature=${signature}`,
      init: { method, headers: { "X-MBX-APIKEY": credentials.apiKey } },
      // A timed-out order may already exist. The execution service reconciles by
      // clientOrderId instead of blindly replaying a state-changing request.
      retryable: false,
    });
    return response.data;
  }

  private baseUrl(environment: ExchangeEnvironment): string {
    if (environment === ExchangeEnvironment.DEMO) {
      throw ExchangeError.invalidRequest(
        this.provider,
        "Binance Futures does not support the DEMO environment",
      );
    }
    return environment === ExchangeEnvironment.TESTNET
      ? this.testnetUrl
      : this.productionUrl;
  }

  private readonly provider = ExchangeProvider.BINANCE_FUTURES;
}
