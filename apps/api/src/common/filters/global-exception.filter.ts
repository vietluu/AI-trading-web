import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { ApiError } from "@platform/shared";
import type { Request, Response } from "express";

import { ExchangeError } from "../../exchange/domain/exchange.error";
import {
  AgentError,
  AgentErrorCode,
} from "../../modules/agents/domain/errors/agent-errors";

function hasMessage(value: object): value is { message: unknown } {
  return "message" in value;
}

function extractMessage(exception: unknown): string {
  if (exception instanceof ExchangeError) return exception.message;
  if (exception instanceof AgentError) return exception.safeMessage;
  if (exception instanceof HttpException) {
    const response = exception.getResponse();

    if (typeof response === "string") {
      return response;
    }

    if (hasMessage(response)) {
      const { message } = response;

      if (Array.isArray(message)) {
        return message.map(String).join(", ");
      }

      if (typeof message === "string") {
        return message;
      }
    }
  }

  return "An unexpected error occurred";
}

function agentErrorStatus(code: AgentErrorCode): HttpStatus {
  switch (code) {
    case AgentErrorCode.AGENT_INPUT_INVALID:
    case AgentErrorCode.AGENT_CONTEXT_INVALID:
    case AgentErrorCode.AGENT_PROMPT_INVALID:
    case AgentErrorCode.AGENT_OUTPUT_INVALID:
      return HttpStatus.BAD_REQUEST;
    case AgentErrorCode.AGENT_AUTHENTICATION_REQUIRED:
      return HttpStatus.UNAUTHORIZED;
    case AgentErrorCode.AGENT_POLICY_DENIED:
    case AgentErrorCode.AGENT_USER_CONTEXT_REQUIRED:
    case AgentErrorCode.AGENT_SECRET_DETECTED:
      return HttpStatus.FORBIDDEN;
    case AgentErrorCode.AGENT_NOT_FOUND:
    case AgentErrorCode.AGENT_VERSION_NOT_FOUND:
    case AgentErrorCode.AGENT_PROMPT_NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case AgentErrorCode.AGENT_QUOTA_EXCEEDED:
    case AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED:
      return HttpStatus.TOO_MANY_REQUESTS;
    case AgentErrorCode.AGENT_BUDGET_EXCEEDED:
      return HttpStatus.PAYMENT_REQUIRED;
    case AgentErrorCode.AGENT_DUPLICATE_RUN:
    case AgentErrorCode.AGENT_STATE_TRANSITION_INVALID:
    case AgentErrorCode.AGENT_CANCELLED:
      return HttpStatus.CONFLICT;
    case AgentErrorCode.AGENT_TIMEOUT:
      return HttpStatus.GATEWAY_TIMEOUT;
    case AgentErrorCode.AGENT_MODEL_UNAVAILABLE:
    case AgentErrorCode.AGENT_PROVIDER_UNAVAILABLE:
    case AgentErrorCode.AGENT_TOOL_UNAVAILABLE:
    case AgentErrorCode.AGENT_UNAVAILABLE:
      return HttpStatus.SERVICE_UNAVAILABLE;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const statusFromObj = typeof (exception as Record<string, unknown>)?.status === "number"
      ? (exception as Record<string, unknown>).status as number
      : typeof (exception as Record<string, unknown>)?.statusCode === "number"
        ? (exception as Record<string, unknown>).statusCode as number
        : undefined;

    const statusCode =
      exception instanceof ExchangeError
        ? exception.statusCode === 401
          ? HttpStatus.BAD_REQUEST
          : exception.statusCode
        : exception instanceof AgentError
          ? agentErrorStatus(exception.code)
        : exception instanceof HttpException
          ? exception.getStatus()
        : statusFromObj && statusFromObj >= 400 && statusFromObj < 600
          ? statusFromObj
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorName =
      exception instanceof ExchangeError
        ? exception.code
        : exception instanceof AgentError
          ? exception.code
        : exception instanceof HttpException
          ? exception.name
        : (exception as Record<string, unknown>)?.code as string || "InternalServerError";

    const body: ApiError = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      message: extractMessage(exception),
      error: errorName,
      ...(exception instanceof ExchangeError
        ? {
            code: exception.code,
            provider: exception.provider,
            retryable: exception.retryable,
            ...(exception.correlationId
              ? { correlationId: exception.correlationId }
              : {}),
          }
        : exception instanceof AgentError
          ? { code: exception.code, retryable: exception.retryable }
          : {}),
    };

    const logContext = {
      event: "http_exception",
      method: request.method,
      path: request.originalUrl,
      statusCode,
      error: errorName,
    };

    if (statusCode >= 500) {
      this.logger.error(
        logContext,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logContext);
    }

    response.status(statusCode).json(body);
  }
}
