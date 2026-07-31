"""Core domain entities for trading orders and positions."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from src.core.domain.value_objects.enums import (
    OrderSide,
    OrderStatus,
    OrderType,
    PositionSide,
    PositionStatus,
)


@dataclass
class Order:
    """Trading order domain entity.

    Represents a trading order with its full lifecycle.

    Attributes:
        id: Unique order identifier (UUID).
        symbol: Trading pair symbol.
        side: Buy or sell.
        order_type: Market, limit, stop, etc.
        quantity: Order quantity in base currency.
        price: Limit price (None for market orders).
        stop_price: Trigger price for stop orders.
        status: Current lifecycle status.
        exchange_order_id: Exchange-assigned order ID.
        strategy_id: Identifier of the strategy that placed this order.
        filled_quantity: Amount filled so far.
        average_fill_price: Average execution price.
        commission: Trading fees paid.
        leverage: Futures leverage applied.
        created_at: Order creation timestamp (UTC).
        updated_at: Last status update timestamp (UTC).
    """

    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: Decimal
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    price: Decimal | None = None
    stop_price: Decimal | None = None
    status: OrderStatus = OrderStatus.PENDING
    exchange_order_id: str | None = None
    strategy_id: str | None = None
    filled_quantity: Decimal = Decimal("0")
    average_fill_price: Decimal | None = None
    commission: Decimal = Decimal("0")
    leverage: int = 1
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def __post_init__(self) -> None:
        """Validate order invariants."""
        if self.quantity <= Decimal("0"):
            raise ValueError("Order quantity must be positive")
        if self.leverage < 1 or self.leverage > 125:
            raise ValueError("Leverage must be between 1 and 125")
        if self.order_type == OrderType.LIMIT and self.price is None:
            raise ValueError("Limit orders require a price")

    @property
    def is_filled(self) -> bool:
        """Check if the order is fully filled."""
        return self.status == OrderStatus.FILLED

    @property
    def is_active(self) -> bool:
        """Check if the order is still active."""
        return self.status in (OrderStatus.OPEN, OrderStatus.PENDING, OrderStatus.PARTIALLY_FILLED)

    @property
    def remaining_quantity(self) -> Decimal:
        """Quantity not yet filled."""
        return self.quantity - self.filled_quantity

    @property
    def notional_value(self) -> Decimal:
        """Estimated notional value of the order."""
        px = self.average_fill_price or self.price or Decimal("0")
        return self.quantity * px


@dataclass
class Position:
    """Futures position domain entity.

    Represents an open or closed perpetual futures position.

    Attributes:
        id: Unique position identifier (UUID).
        symbol: Trading pair symbol.
        side: Long or short.
        quantity: Position size in base currency.
        entry_price: Average entry price.
        current_price: Latest mark price.
        leverage: Applied leverage.
        status: Open, closed, or liquidated.
        stop_loss_price: Stop-loss trigger price.
        take_profit_price: Take-profit trigger price.
        strategy_id: Strategy that opened this position.
        unrealized_pnl: Current unrealized profit/loss.
        realized_pnl: Locked-in profit/loss on partial closes.
        commission: Total commission paid.
        liquidation_price: Estimated liquidation price.
        opened_at: Position open timestamp (UTC).
        closed_at: Position close timestamp (UTC).
    """

    symbol: str
    side: PositionSide
    quantity: Decimal
    entry_price: Decimal
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    current_price: Decimal = Decimal("0")
    leverage: int = 1
    status: PositionStatus = PositionStatus.OPEN
    stop_loss_price: Decimal | None = None
    take_profit_price: Decimal | None = None
    strategy_id: str | None = None
    realized_pnl: Decimal = Decimal("0")
    commission: Decimal = Decimal("0")
    liquidation_price: Decimal | None = None
    opened_at: datetime = field(default_factory=datetime.utcnow)
    closed_at: datetime | None = None

    def __post_init__(self) -> None:
        """Validate position invariants."""
        if self.quantity <= Decimal("0"):
            raise ValueError("Position quantity must be positive")
        if self.entry_price <= Decimal("0"):
            raise ValueError("Entry price must be positive")

    @property
    def unrealized_pnl(self) -> Decimal:
        """Calculate unrealized P&L based on current mark price."""
        if self.current_price <= Decimal("0"):
            return Decimal("0")
        price_diff = self.current_price - self.entry_price
        if self.side == PositionSide.SHORT:
            price_diff = -price_diff
        return price_diff * self.quantity * self.leverage

    @property
    def unrealized_pnl_pct(self) -> Decimal:
        """Unrealized P&L as a percentage of margin used."""
        margin = (self.entry_price * self.quantity) / self.leverage
        if margin <= Decimal("0"):
            return Decimal("0")
        return (self.unrealized_pnl / margin) * Decimal("100")

    @property
    def notional_value(self) -> Decimal:
        """Current notional value of the position."""
        return (self.current_price or self.entry_price) * self.quantity

    @property
    def margin_used(self) -> Decimal:
        """Margin locked for this position."""
        return (self.entry_price * self.quantity) / self.leverage

    @property
    def total_pnl(self) -> Decimal:
        """Combined realized + unrealized P&L minus commission."""
        return self.realized_pnl + self.unrealized_pnl - self.commission

    @property
    def is_open(self) -> bool:
        """Check if position is still open."""
        return self.status == PositionStatus.OPEN

    def update_price(self, price: Decimal) -> None:
        """Update mark price."""
        if price <= Decimal("0"):
            raise ValueError("Price must be positive")
        self.current_price = price
