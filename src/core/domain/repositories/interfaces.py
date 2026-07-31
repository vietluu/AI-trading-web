"""Abstract repository interfaces (ports) following Clean Architecture."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from src.core.domain.entities.market_data import OHLCV
from src.core.domain.entities.research import NewsArticle, OnChainMetric, SentimentData
from src.core.domain.entities.signal import TradingSignal
from src.core.domain.entities.trading import Order, Position
from src.core.domain.value_objects.enums import Timeframe


class IOHLCVRepository(ABC):
    """Abstract repository for OHLCV candlestick data."""

    @abstractmethod
    async def save(self, ohlcv: OHLCV) -> None:
        """Persist a single OHLCV bar."""

    @abstractmethod
    async def save_batch(self, bars: list[OHLCV]) -> None:
        """Persist multiple OHLCV bars in one operation."""

    @abstractmethod
    async def get_latest(
        self,
        symbol: str,
        timeframe: Timeframe,
        limit: int = 100,
    ) -> list[OHLCV]:
        """Return the most recent ``limit`` bars for a symbol."""

    @abstractmethod
    async def get_range(
        self,
        symbol: str,
        timeframe: Timeframe,
        start: datetime,
        end: datetime,
    ) -> list[OHLCV]:
        """Return bars within a time range."""


class ISignalRepository(ABC):
    """Abstract repository for trading signals."""

    @abstractmethod
    async def save(self, signal: TradingSignal) -> None:
        """Persist a signal."""

    @abstractmethod
    async def get_active(self, symbol: str) -> list[TradingSignal]:
        """Return non-expired signals for a symbol."""

    @abstractmethod
    async def get_by_id(self, signal_id: str) -> TradingSignal | None:
        """Return a signal by its ID."""

    @abstractmethod
    async def get_latest(self, symbol: str, limit: int = 20) -> list[TradingSignal]:
        """Return the most recent signals for a symbol."""


class IOrderRepository(ABC):
    """Abstract repository for orders."""

    @abstractmethod
    async def save(self, order: Order) -> None:
        """Persist an order."""

    @abstractmethod
    async def update(self, order: Order) -> None:
        """Update an existing order."""

    @abstractmethod
    async def get_by_id(self, order_id: str) -> Order | None:
        """Return an order by its UUID."""

    @abstractmethod
    async def get_by_exchange_id(self, exchange_order_id: str) -> Order | None:
        """Return an order by its exchange-assigned ID."""

    @abstractmethod
    async def get_open_orders(self, symbol: str | None = None) -> list[Order]:
        """Return all open orders, optionally filtered by symbol."""


class IPositionRepository(ABC):
    """Abstract repository for positions."""

    @abstractmethod
    async def save(self, position: Position) -> None:
        """Persist a position."""

    @abstractmethod
    async def update(self, position: Position) -> None:
        """Update an existing position."""

    @abstractmethod
    async def get_by_id(self, position_id: str) -> Position | None:
        """Return a position by its UUID."""

    @abstractmethod
    async def get_open_positions(self, symbol: str | None = None) -> list[Position]:
        """Return all open positions."""

    @abstractmethod
    async def get_closed_positions(
        self,
        symbol: str | None = None,
        limit: int = 100,
    ) -> list[Position]:
        """Return recent closed positions."""


class INewsRepository(ABC):
    """Abstract repository for news articles."""

    @abstractmethod
    async def save(self, article: NewsArticle) -> None:
        """Persist a news article."""

    @abstractmethod
    async def save_batch(self, articles: list[NewsArticle]) -> None:
        """Persist multiple articles."""

    @abstractmethod
    async def get_latest(
        self,
        symbols: list[str] | None = None,
        limit: int = 50,
    ) -> list[NewsArticle]:
        """Return recent articles, optionally filtered by symbols."""


class ISentimentRepository(ABC):
    """Abstract repository for sentiment data."""

    @abstractmethod
    async def save(self, sentiment: SentimentData) -> None:
        """Persist a sentiment data point."""

    @abstractmethod
    async def get_latest(
        self,
        symbol: str,
        limit: int = 10,
    ) -> list[SentimentData]:
        """Return recent sentiment data points for a symbol."""


class IOnChainRepository(ABC):
    """Abstract repository for on-chain metrics."""

    @abstractmethod
    async def save(self, metric: OnChainMetric) -> None:
        """Persist an on-chain metric."""

    @abstractmethod
    async def get_latest(
        self,
        symbol: str,
        metric_name: str,
        limit: int = 30,
    ) -> list[OnChainMetric]:
        """Return recent on-chain metrics."""
