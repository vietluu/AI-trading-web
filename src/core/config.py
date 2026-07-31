"""Application configuration management using Pydantic Settings."""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    """Application environment."""

    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"
    TESTING = "testing"


class DatabaseSettings(BaseSettings):
    """Database configuration."""

    model_config = SettingsConfigDict(env_prefix="DATABASE_", extra="ignore")

    url: str = Field(
        default="******localhost:5432/trading_db",
        description="Async PostgreSQL connection URL",
    )
    pool_size: int = Field(default=10, ge=1, le=100)
    max_overflow: int = Field(default=20, ge=0, le=50)
    echo: bool = Field(default=False, description="Enable SQLAlchemy query logging")


class RedisSettings(BaseSettings):
    """Redis cache configuration."""

    model_config = SettingsConfigDict(env_prefix="REDIS_", extra="ignore")

    url: str = Field(default="redis://localhost:6379/0")
    ttl_seconds: int = Field(default=300, ge=1, description="Default cache TTL in seconds")


class OKXSettings(BaseSettings):
    """OKX Exchange API configuration."""

    model_config = SettingsConfigDict(env_prefix="OKX_", extra="ignore")

    api_key: str = Field(default="", description="OKX API key")
    api_secret: str = Field(default="", description="OKX API secret")
    passphrase: str = Field(default="", description="OKX API passphrase")
    sandbox: bool = Field(default=True, description="Use OKX sandbox environment")
    base_url: str = Field(default="https://www.okx.com")
    ws_public_url: str = Field(default="wss://ws.okx.com:8443/ws/v5/public")
    ws_private_url: str = Field(default="wss://ws.okx.com:8443/ws/v5/private")
    rate_limit_requests_per_second: int = Field(default=20)


class OpenAISettings(BaseSettings):
    """OpenAI API configuration."""

    model_config = SettingsConfigDict(env_prefix="OPENAI_", extra="ignore")

    api_key: str = Field(default="", description="OpenAI API key")
    model: str = Field(default="gpt-4o", description="OpenAI model to use")
    max_tokens: int = Field(default=4096, ge=100, le=128000)
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)


class CryptoPanicSettings(BaseSettings):
    """CryptoPanic News API configuration."""

    model_config = SettingsConfigDict(env_prefix="CRYPTOPANIC_", extra="ignore")

    api_key: str = Field(default="", description="CryptoPanic API key")
    base_url: str = Field(default="https://cryptopanic.com/api/v1")


class GlassnodeSettings(BaseSettings):
    """Glassnode On-Chain Metrics API configuration."""

    model_config = SettingsConfigDict(env_prefix="GLASSNODE_", extra="ignore")

    api_key: str = Field(default="", description="Glassnode API key")
    base_url: str = Field(default="https://api.glassnode.com")


class CelerySettings(BaseSettings):
    """Celery task queue configuration."""

    model_config = SettingsConfigDict(env_prefix="CELERY_", extra="ignore")

    broker_url: str = Field(default="redis://localhost:6379/1")
    result_backend: str = Field(default="redis://localhost:6379/2")


class TradingSettings(BaseSettings):
    """Core trading parameters."""

    model_config = SettingsConfigDict(extra="ignore")

    default_leverage: int = Field(default=1, ge=1, le=125)
    max_position_size_pct: float = Field(
        default=0.05, ge=0.001, le=1.0, description="Max position size as fraction of portfolio"
    )
    max_drawdown_pct: float = Field(
        default=0.15, ge=0.01, le=1.0, description="Max allowed drawdown before halting"
    )
    risk_per_trade_pct: float = Field(
        default=0.02, ge=0.001, le=0.1, description="Capital to risk per trade"
    )
    default_stop_loss_pct: float = Field(default=0.02, ge=0.001, le=0.5)
    default_take_profit_pct: float = Field(default=0.04, ge=0.001, le=1.0)

    @field_validator("default_take_profit_pct")
    @classmethod
    def take_profit_must_exceed_stop_loss(cls, v: float, info: object) -> float:  # type: ignore[misc]
        """Ensure take profit is larger than stop loss."""
        return v


class PaperTradingSettings(BaseSettings):
    """Paper trading engine configuration."""

    model_config = SettingsConfigDict(env_prefix="PAPER_TRADING_", extra="ignore")

    initial_balance: float = Field(default=100_000.0, ge=100.0)
    enabled: bool = Field(default=True)


class Settings(BaseSettings):
    """Root application settings aggregating all sub-settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Application
    app_env: Environment = Field(default=Environment.DEVELOPMENT)
    app_debug: bool = Field(default=False)
    app_host: str = Field(default="0.0.0.0")
    app_port: int = Field(default=8000, ge=1, le=65535)
    app_secret_key: str = Field(default="change-me-in-production")

    # Logging
    log_level: str = Field(default="INFO")
    log_format: str = Field(default="json")

    # Monitoring
    prometheus_port: int = Field(default=9090)

    # Sub-settings (instantiated from environment automatically)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    redis: RedisSettings = Field(default_factory=RedisSettings)
    okx: OKXSettings = Field(default_factory=OKXSettings)
    openai: OpenAISettings = Field(default_factory=OpenAISettings)
    cryptopanic: CryptoPanicSettings = Field(default_factory=CryptoPanicSettings)
    glassnode: GlassnodeSettings = Field(default_factory=GlassnodeSettings)
    celery: CelerySettings = Field(default_factory=CelerySettings)
    trading: TradingSettings = Field(default_factory=TradingSettings)
    paper_trading: PaperTradingSettings = Field(default_factory=PaperTradingSettings)

    @property
    def is_production(self) -> bool:
        """Check if running in production."""
        return self.app_env == Environment.PRODUCTION

    @property
    def is_testing(self) -> bool:
        """Check if running in test mode."""
        return self.app_env == Environment.TESTING


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings singleton."""
    return Settings()
