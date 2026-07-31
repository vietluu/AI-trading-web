"""Redis cache client with structured key management."""

from __future__ import annotations

import json
from typing import Any

import redis.asyncio as aioredis

from src.core.config import get_settings
from src.core.logging import get_logger

logger = get_logger(__name__)

_redis_client: aioredis.Redis | None = None  # type: ignore[type-arg]


def get_redis() -> aioredis.Redis:  # type: ignore[type-arg]
    """Return the global Redis client, creating it if necessary."""
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = aioredis.from_url(
            settings.redis.url,
            encoding="utf-8",
            decode_responses=True,
        )
        logger.info("Redis client created", url=settings.redis.url)
    return _redis_client


async def close_redis() -> None:
    """Close the Redis connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
    logger.info("Redis client closed")


class CacheClient:
    """High-level cache operations with JSON serialization.

    Wraps Redis with typed get/set operations and key namespacing.
    """

    def __init__(self, namespace: str = "trading") -> None:
        self._ns = namespace

    def _key(self, *parts: str) -> str:
        """Build a namespaced cache key."""
        return f"{self._ns}:{':'.join(parts)}"

    async def get(self, *key_parts: str) -> Any:
        """Retrieve and deserialize a cached value.

        Returns None if the key does not exist or on error.
        """
        redis = get_redis()
        try:
            raw = await redis.get(self._key(*key_parts))
            if raw is None:
                return None
            return json.loads(raw)
        except Exception as exc:
            logger.warning("Cache get failed", key=self._key(*key_parts), error=str(exc))
            return None

    async def set(
        self,
        *key_parts: str,
        value: Any,
        ttl: int | None = None,
    ) -> None:
        """Serialize and cache a value with optional TTL.

        Args:
            *key_parts: Key path segments.
            value: JSON-serializable value.
            ttl: Time-to-live in seconds. Defaults to config default.
        """
        settings = get_settings()
        redis = get_redis()
        effective_ttl = ttl if ttl is not None else settings.redis.ttl_seconds
        try:
            await redis.set(self._key(*key_parts), json.dumps(value), ex=effective_ttl)
        except Exception as exc:
            logger.warning("Cache set failed", key=self._key(*key_parts), error=str(exc))

    async def delete(self, *key_parts: str) -> None:
        """Delete a cached key."""
        redis = get_redis()
        try:
            await redis.delete(self._key(*key_parts))
        except Exception as exc:
            logger.warning("Cache delete failed", key=self._key(*key_parts), error=str(exc))

    async def exists(self, *key_parts: str) -> bool:
        """Check if a key exists in the cache."""
        redis = get_redis()
        try:
            return bool(await redis.exists(self._key(*key_parts)))
        except Exception as exc:
            logger.warning("Cache exists check failed", key=self._key(*key_parts), error=str(exc))
            return False

    async def publish(self, channel: str, message: Any) -> None:
        """Publish a message to a Redis pub/sub channel."""
        redis = get_redis()
        try:
            await redis.publish(channel, json.dumps(message))
        except Exception as exc:
            logger.warning("Redis publish failed", channel=channel, error=str(exc))
