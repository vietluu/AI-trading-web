"""Core domain value objects — immutable primitives for the trading domain."""

from __future__ import annotations

from decimal import Decimal
from enum import Enum
from typing import Final


class Currency(str, Enum):
    """Supported quote currencies."""

    USDT = "USDT"
    USDC = "USDC"
    BTC = "BTC"


class OrderSide(str, Enum):
    """Direction of a trade order."""

    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    """Order execution type."""

    MARKET = "market"
    LIMIT = "limit"
    STOP_MARKET = "stop_market"
    STOP_LIMIT = "stop_limit"
    TAKE_PROFIT_MARKET = "take_profit_market"


class OrderStatus(str, Enum):
    """Lifecycle state of an order."""

    PENDING = "pending"
    OPEN = "open"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class PositionSide(str, Enum):
    """Futures position direction."""

    LONG = "long"
    SHORT = "short"


class PositionStatus(str, Enum):
    """Lifecycle state of a position."""

    OPEN = "open"
    CLOSED = "closed"
    LIQUIDATED = "liquidated"


class Timeframe(str, Enum):
    """Supported OHLCV candlestick timeframes."""

    M1 = "1m"
    M3 = "3m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H2 = "2h"
    H4 = "4h"
    H6 = "6h"
    H12 = "12h"
    D1 = "1d"
    W1 = "1w"


class SignalDirection(str, Enum):
    """Trading signal direction."""

    LONG = "long"
    SHORT = "short"
    NEUTRAL = "neutral"


class SignalStrength(str, Enum):
    """Confidence level of a trading signal."""

    STRONG = "strong"
    MODERATE = "moderate"
    WEAK = "weak"


class SentimentLabel(str, Enum):
    """Market sentiment classification."""

    VERY_BULLISH = "very_bullish"
    BULLISH = "bullish"
    NEUTRAL = "neutral"
    BEARISH = "bearish"
    VERY_BEARISH = "very_bearish"


class NewsImpact(str, Enum):
    """Estimated market impact of a news item."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Type aliases for domain clarity
Price = Decimal
Quantity = Decimal
Percentage = Decimal

# Constants
ZERO: Final[Decimal] = Decimal("0")
ONE: Final[Decimal] = Decimal("1")
