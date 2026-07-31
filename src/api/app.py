"""FastAPI application factory and startup/shutdown lifecycle hooks."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import make_asgi_app

from src.api.middleware.logging_middleware import LoggingMiddleware
from src.api.v1.routes import (
    backtesting,
    health,
    market_data,
    paper_trading,
    signals,
)
from src.core.config import get_settings
from src.core.logging import configure_logging, get_logger
from src.infrastructure.cache.redis_client import close_redis

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    """Application lifespan manager — handles startup and shutdown."""
    configure_logging()
    settings = get_settings()
    logger.info(
        "Starting AI Trading Platform",
        env=settings.app_env.value,
        version=app.version,
    )

    # Note: DB tables are created via Alembic migrations in production.
    # For development convenience, we can create them here.
    if settings.app_env.value in ("development", "testing"):
        try:
            from src.infrastructure.database.engine import create_all_tables

            await create_all_tables()
        except Exception as exc:
            logger.warning("Could not create DB tables", error=str(exc))

    yield

    # Shutdown
    await close_redis()
    try:
        from src.infrastructure.database.engine import close_engine

        await close_engine()
    except Exception:
        pass
    logger.info("Application shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Fully configured FastAPI application instance.
    """
    settings = get_settings()

    app = FastAPI(
        title="AI Trading Platform",
        description=(
            "Production-ready AI-powered cryptocurrency futures trading research platform. "
            "Provides market data, AI analysis, signal generation, risk management, "
            "paper trading, and backtesting capabilities."
        ),
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if not settings.is_production else [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Structured logging middleware
    app.add_middleware(LoggingMiddleware)

    # Register API routers
    app.include_router(health.router, prefix="/api/v1", tags=["health"])
    app.include_router(market_data.router, prefix="/api/v1/market", tags=["market-data"])
    app.include_router(signals.router, prefix="/api/v1/signals", tags=["signals"])
    app.include_router(paper_trading.router, prefix="/api/v1/paper-trading", tags=["paper-trading"])
    app.include_router(backtesting.router, prefix="/api/v1/backtesting", tags=["backtesting"])

    # Prometheus metrics endpoint
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)

    # Global exception handler
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled exception",
            path=str(request.url.path),
            method=request.method,
            error=str(exc),
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred. Please try again later.",
            },
        )

    return app


app = create_app()
