"""SQLAlchemy ORM models for all platform entities."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    Float,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.infrastructure.database.engine import Base


class OHLCVModel(Base):
    """Persisted OHLCV candlestick bar."""

    __tablename__ = "ohlcv"
    __table_args__ = (
        UniqueConstraint("symbol", "timeframe", "timestamp", name="uq_ohlcv_symbol_tf_ts"),
        Index("ix_ohlcv_symbol_timeframe_ts", "symbol", "timeframe", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    high: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    low: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    close: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    volume: Mapped[Decimal] = mapped_column(Numeric(32, 8), nullable=False)
    quote_volume: Mapped[Decimal] = mapped_column(Numeric(32, 8), default=Decimal("0"))
    trades: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )


class NewsArticleModel(Base):
    """Persisted news article."""

    __tablename__ = "news_articles"
    __table_args__ = (
        UniqueConstraint("url", name="uq_news_url"),
        Index("ix_news_published_at", "published_at"),
        Index("ix_news_source", "source"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    symbols: Mapped[str] = mapped_column(Text, default="")  # JSON array
    sentiment: Mapped[str] = mapped_column(String(20), default="neutral")
    impact: Mapped[str] = mapped_column(String(10), default="low")
    summary: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )


class SentimentDataModel(Base):
    """Persisted sentiment data point."""

    __tablename__ = "sentiment_data"
    __table_args__ = (Index("ix_sentiment_symbol_ts", "symbol", "timestamp"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    fear_greed_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    social_volume: Mapped[float] = mapped_column(Float, default=0.0)
    bullish_mentions: Mapped[int] = mapped_column(Integer, default=0)
    bearish_mentions: Mapped[int] = mapped_column(Integer, default=0)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OnChainMetricModel(Base):
    """Persisted on-chain metric data point."""

    __tablename__ = "onchain_metrics"
    __table_args__ = (
        Index("ix_onchain_symbol_metric_ts", "symbol", "metric_name", "timestamp"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    metric_name: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SignalModel(Base):
    """Persisted trading signal."""

    __tablename__ = "signals"
    __table_args__ = (
        Index("ix_signals_symbol_created_at", "symbol", "created_at"),
        Index("ix_signals_direction", "direction"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    strength: Mapped[str] = mapped_column(String(10), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    stop_loss_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    take_profit_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    technical_indicators: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    ai_analysis_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OrderModel(Base):
    """Persisted trading order."""

    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_symbol_status", "symbol", "status"),
        Index("ix_orders_exchange_id", "exchange_order_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    side: Mapped[str] = mapped_column(String(10), nullable=False)
    order_type: Mapped[str] = mapped_column(String(25), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    stop_price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    exchange_order_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    strategy_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    filled_quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    average_fill_price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    commission: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    leverage: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PositionModel(Base):
    """Persisted futures position."""

    __tablename__ = "positions"
    __table_args__ = (
        Index("ix_positions_symbol_status", "symbol", "status"),
        Index("ix_positions_opened_at", "opened_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    side: Mapped[str] = mapped_column(String(10), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    current_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    leverage: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(15), nullable=False)
    stop_loss_price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    take_profit_price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    strategy_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    realized_pnl: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    commission: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    liquidation_price: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BacktestResultModel(Base):
    """Persisted backtesting run result."""

    __tablename__ = "backtest_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    strategy_name: Mapped[str] = mapped_column(String(100), nullable=False)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    initial_capital: Mapped[float] = mapped_column(Float, nullable=False)
    final_capital: Mapped[float] = mapped_column(Float, nullable=False)
    total_return_pct: Mapped[float] = mapped_column(Float, nullable=False)
    sharpe_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    max_drawdown_pct: Mapped[float] = mapped_column(Float, default=0.0)
    win_rate: Mapped[float] = mapped_column(Float, default=0.0)
    total_trades: Mapped[int] = mapped_column(Integer, default=0)
    winning_trades: Mapped[int] = mapped_column(Integer, default=0)
    losing_trades: Mapped[int] = mapped_column(Integer, default=0)
    avg_win_pct: Mapped[float] = mapped_column(Float, default=0.0)
    avg_loss_pct: Mapped[float] = mapped_column(Float, default=0.0)
    profit_factor: Mapped[float] = mapped_column(Float, default=0.0)
    parameters: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
