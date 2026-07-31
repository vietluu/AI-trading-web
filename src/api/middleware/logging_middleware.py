"""Request/response logging middleware."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = structlog.get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request and response with timing and correlation ID.

    Adds a ``X-Request-ID`` header to each response for tracing.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:  # type: ignore[override]
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        start_time = time.perf_counter()

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        logger.info("Request started")

        try:
            response = await call_next(request)
            elapsed_ms = (time.perf_counter() - start_time) * 1000

            logger.info(
                "Request completed",
                status_code=response.status_code,
                duration_ms=round(elapsed_ms, 2),
            )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.error("Request failed", error=str(exc), duration_ms=round(elapsed_ms, 2))
            raise

        response.headers["X-Request-ID"] = request_id
        return response
