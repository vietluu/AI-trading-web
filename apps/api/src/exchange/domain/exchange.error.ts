import { HttpStatus } from "@nestjs/common";

import type { ExchangeProvider } from "./exchange.types";

export enum ExchangeErrorCode {
  UNAVAILABLE = "EXCHANGE_UNAVAILABLE",
  TIMEOUT = "EXCHANGE_TIMEOUT",
  RATE_LIMITED = "EXCHANGE_RATE_LIMITED",
  AUTHENTICATION_FAILED = "EXCHANGE_AUTHENTICATION_FAILED",
  PERMISSION_DENIED = "EXCHANGE_PERMISSION_DENIED",
  INVALID_CREDENTIALS = "EXCHANGE_INVALID_CREDENTIALS",
  INVALID_SIGNATURE = "EXCHANGE_INVALID_SIGNATURE",
  TIMESTAMP_INVALID = "EXCHANGE_TIMESTAMP_INVALID",
  INVALID_SYMBOL = "EXCHANGE_INVALID_SYMBOL",
  INVALID_REQUEST = "EXCHANGE_INVALID_REQUEST",
  RESOURCE_NOT_FOUND = "EXCHANGE_RESOURCE_NOT_FOUND",
  ACCOUNT_RESTRICTED = "EXCHANGE_ACCOUNT_RESTRICTED",
  INSUFFICIENT_BALANCE = "EXCHANGE_INSUFFICIENT_BALANCE",
  ENTRY_PROTECTION_GEOMETRY_INVALID = "ENTRY_PROTECTION_GEOMETRY_INVALID",
  STOP_ALREADY_BREACHED = "STOP_ALREADY_BREACHED",
  TAKE_PROFIT_ALREADY_CROSSED = "TAKE_PROFIT_ALREADY_CROSSED",
  MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED = "MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED",
  UNKNOWN = "EXCHANGE_UNKNOWN_ERROR",
}

export class ExchangeError extends Error {
  constructor(
    readonly code: ExchangeErrorCode,
    readonly provider: ExchangeProvider,
    readonly retryable: boolean,
    readonly statusCode: number,
    message: string,
    readonly exchangeCode?: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ExchangeError";
  }

  static invalidRequest(
    provider: ExchangeProvider,
    message: string,
  ): ExchangeError {
    return new ExchangeError(
      ExchangeErrorCode.INVALID_REQUEST,
      provider,
      false,
      HttpStatus.BAD_REQUEST,
      message,
    );
  }

  static protectionPreflight(
    provider: ExchangeProvider,
    reason: string,
  ): ExchangeError {
    return new ExchangeError(
      reason as ExchangeErrorCode,
      provider,
      false,
      HttpStatus.BAD_REQUEST,
      reason,
    );
  }
}
