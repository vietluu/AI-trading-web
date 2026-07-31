"""SQLAlchemy async database engine and session management."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from src.core.config import get_settings
from src.core.logging import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    """Declarative base for all SQLAlchemy models."""


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def create_engine() -> AsyncEngine:
    """Create and return the async SQLAlchemy engine."""
    settings = get_settings()
    engine = create_async_engine(
        settings.database.url,
        pool_size=settings.database.pool_size,
        max_overflow=settings.database.max_overflow,
        echo=settings.database.echo,
        pool_pre_ping=True,
    )
    logger.info("Database engine created", url=settings.database.url)
    return engine


def get_engine() -> AsyncEngine:
    """Return the global async engine, creating it if necessary."""
    global _engine
    if _engine is None:
        _engine = create_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the global session factory, creating it if necessary."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _session_factory


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager providing a database session with auto-rollback.

    Usage::

        async with get_db_session() as session:
            result = await session.execute(...)
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def create_all_tables() -> None:
    """Create all database tables (idempotent)."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("All database tables created")


async def drop_all_tables() -> None:
    """Drop all database tables — USE ONLY IN TESTS."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    logger.warning("All database tables dropped")


async def close_engine() -> None:
    """Dispose the engine connection pool."""
    global _engine, _session_factory
    if _engine:
        await _engine.dispose()
        _engine = None
        _session_factory = None
    logger.info("Database engine closed")
