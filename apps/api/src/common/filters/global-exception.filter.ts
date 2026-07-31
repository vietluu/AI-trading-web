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

function hasMessage(value: object): value is { message: unknown } {
  return "message" in value;
}

function extractMessage(exception: unknown): string {
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

  if (exception instanceof Error && exception.message.length > 0) {
    return exception.message;
  }

  return "An unexpected error occurred";
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorName =
      exception instanceof Error
        ? exception.name
        : String(HttpStatus[statusCode] ?? "Error");

    const body: ApiError = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      message: extractMessage(exception),
      error: errorName,
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
