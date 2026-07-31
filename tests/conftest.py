"""Shared pytest configuration and fixtures."""

from __future__ import annotations

import os

# Use testing environment
os.environ.setdefault("APP_ENV", "testing")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_trading.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("OKX_API_KEY", "test-key")
os.environ.setdefault("OKX_API_SECRET", "test-secret")
os.environ.setdefault("OKX_PASSPHRASE", "test-passphrase")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
