"""Health check endpoints."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter

from src.core.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health", summary="Platform health check")
async def health_check() -> dict[str, Any]:
    """Return the current health status of the platform.

    Checks connectivity to key dependencies and returns
    an overall health summary.
    """
    settings = get_settings()

    checks: dict[str, str] = {}

    # Redis check
    try:
        from src.infrastructure.cache.redis_client import get_redis

        redis = get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception:
        logger.exception("Redis health check failed")
        checks["redis"] = "error"

    # Database check
    try:
        from sqlalchemy import text

        from src.infrastructure.database.engine import get_db_session

        async with get_db_session() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        logger.exception("Database health check failed")
        checks["database"] = "error"

    all_ok = all(v == "ok" for v in checks.values())

    return {
        "status": "healthy" if all_ok else "degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "0.1.0",
        "environment": settings.app_env.value,
        "checks": checks,
    }


@router.get("/ready", summary="Readiness probe")
async def readiness() -> dict[str, str]:
    """Kubernetes-style readiness probe.

    Returns 200 when the application is ready to serve traffic.
    """
    return {"status": "ready"}
