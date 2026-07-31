"""Core domain entity: OHLCV (candlestick) market data."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from src.core.domain.value_objects.enums import Timeframe


@dataclass(frozen=True)
class OHLCV:
    """Open-High-Low-Close-Volume candlestick bar.

    Immutable value object representing a single candlestick.

    Attributes:
        symbol: Trading pair symbol, e.g. ``BTC-USDT-SWAP``.
        timeframe: Candlestick interval.
        timestamp: Bar open timestamp (UTC).
        open: Opening price.
        high: Highest price during the interval.
        low: Lowest price during the interval.
        close: Closing price.
        volume: Trading volume in base currency.
        quote_volume: Trading volume in quote currency.
        trades: Number of trades (optional).
    """

    symbol: str
    timeframe: Timeframe
    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    quote_volume: Decimal = Decimal("0")
    trades: int = 0

    def __post_init__(self) -> None:
        """Validate OHLCV invariants."""
        if self.high < self.low:
            raise ValueError(f"High ({self.high}) must be >= Low ({self.low})")
        if self.high < self.open or self.high < self.close:
            raise ValueError("High must be the maximum of OHLC prices")
        if self.low > self.open or self.low > self.close:
            raise ValueError("Low must be the minimum of OHLC prices")
        if self.volume < Decimal("0"):
            raise ValueError("Volume cannot be negative")

    @property
    def is_bullish(self) -> bool:
        """Return True if close > open (green candle)."""
        return self.close > self.open

    @property
    def is_bearish(self) -> bool:
        """Return True if close < open (red candle)."""
        return self.close < self.open

    @property
    def body_size(self) -> Decimal:
        """Absolute difference between open and close."""
        return abs(self.close - self.open)

    @property
    def upper_wick(self) -> Decimal:
        """Upper shadow length."""
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> Decimal:
        """Lower shadow length."""
        return min(self.open, self.close) - self.low

    @property
    def range(self) -> Decimal:
        """High minus Low (total range)."""
        return self.high - self.low

    @property
    def typical_price(self) -> Decimal:
        """(High + Low + Close) / 3 — used in technical indicators."""
        return (self.high + self.low + self.close) / Decimal("3")


@dataclass
class OrderBook:
    """Level-2 order book snapshot.

    Attributes:
        symbol: Trading pair symbol.
        timestamp: Snapshot timestamp (UTC).
        bids: List of (price, quantity) tuples, best bid first.
        asks: List of (price, quantity) tuples, best ask first.
    """

    symbol: str
    timestamp: datetime
    bids: list[tuple[Decimal, Decimal]] = field(default_factory=list)
    asks: list[tuple[Decimal, Decimal]] = field(default_factory=list)

    @property
    def best_bid(self) -> Decimal | None:
        """Return the best (highest) bid price."""
        return self.bids[0][0] if self.bids else None

    @property
    def best_ask(self) -> Decimal | None:
        """Return the best (lowest) ask price."""
        return self.asks[0][0] if self.asks else None

    @property
    def spread(self) -> Decimal | None:
        """Bid-ask spread."""
        if self.best_bid and self.best_ask:
            return self.best_ask - self.best_bid
        return None

    @property
    def mid_price(self) -> Decimal | None:
        """Mid-point between best bid and ask."""
        if self.best_bid and self.best_ask:
            return (self.best_bid + self.best_ask) / Decimal("2")
        return None


@dataclass(frozen=True)
class Ticker:
    """Real-time ticker data.

    Attributes:
        symbol: Trading pair symbol.
        timestamp: Ticker timestamp (UTC).
        last: Last traded price.
        bid: Best bid price.
        ask: Best ask price.
        volume_24h: 24-hour trading volume in base currency.
        price_change_24h: Absolute price change over 24 hours.
        price_change_pct_24h: Percentage price change over 24 hours.
        funding_rate: Current funding rate (for perpetual futures).
        open_interest: Open interest in base currency (for futures).
    """

    symbol: str
    timestamp: datetime
    last: Decimal
    bid: Decimal
    ask: Decimal
    volume_24h: Decimal
    price_change_24h: Decimal = Decimal("0")
    price_change_pct_24h: Decimal = Decimal("0")
    funding_rate: Decimal | None = None
    open_interest: Decimal | None = None
