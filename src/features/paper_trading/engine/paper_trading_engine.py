"""Paper trading engine.

Simulates trade execution against real-time market prices
without placing actual orders on the exchange.
Tracks P&L, positions, orders, and portfolio performance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from src.core.domain.entities.signal import TradingSignal
from src.core.domain.entities.trading import Order, Position
from src.core.domain.value_objects.enums import (
    OrderSide,
    OrderStatus,
    OrderType,
    PositionSide,
    PositionStatus,
    SignalDirection,
)
from src.core.logging import get_logger
from src.features.risk_management.calculators.risk_manager import RiskAssessment

logger = get_logger(__name__)

MAKER_FEE = Decimal("0.0002")  # 0.02% OKX maker fee
TAKER_FEE = Decimal("0.0005")  # 0.05% OKX taker fee


@dataclass
class PaperPortfolio:
    """Snapshot of the paper trading portfolio state.

    Attributes:
        initial_balance: Starting balance in USDT.
        cash_balance: Available cash in USDT.
        open_positions: Currently open positions.
        closed_positions: Historical closed positions.
        open_orders: Pending orders.
        filled_orders: Executed orders.
        total_realized_pnl: Sum of realized P&L.
        total_commission: Sum of commissions paid.
        peak_value: Highest ever portfolio value (for drawdown).
        created_at: Portfolio creation timestamp.
    """

    initial_balance: Decimal
    cash_balance: Decimal = field(init=False)
    open_positions: list[Position] = field(default_factory=list)
    closed_positions: list[Position] = field(default_factory=list)
    open_orders: list[Order] = field(default_factory=list)
    filled_orders: list[Order] = field(default_factory=list)
    total_realized_pnl: Decimal = Decimal("0")
    total_commission: Decimal = Decimal("0")
    peak_value: Decimal = field(init=False)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def __post_init__(self) -> None:
        self.cash_balance = self.initial_balance
        self.peak_value = self.initial_balance

    @property
    def total_unrealized_pnl(self) -> Decimal:
        """Sum of unrealized P&L across open positions."""
        return sum((p.unrealized_pnl for p in self.open_positions), Decimal("0"))

    @property
    def equity(self) -> Decimal:
        """Total equity = cash + unrealized P&L."""
        return self.cash_balance + self.total_unrealized_pnl

    @property
    def total_return_pct(self) -> Decimal:
        """Total return as percentage of initial balance."""
        if self.initial_balance <= Decimal("0"):
            return Decimal("0")
        return ((self.equity - self.initial_balance) / self.initial_balance) * Decimal("100")

    @property
    def max_drawdown_pct(self) -> Decimal:
        """Current drawdown from peak equity."""
        if self.peak_value <= Decimal("0"):
            return Decimal("0")
        return ((self.peak_value - self.equity) / self.peak_value) * Decimal("100")

    def update_peak(self) -> None:
        """Update the peak equity value."""
        if self.equity > self.peak_value:
            self.peak_value = self.equity

    def to_summary(self) -> dict[str, Any]:
        """Return a summary dict for API responses."""
        return {
            "initial_balance": float(self.initial_balance),
            "cash_balance": float(self.cash_balance),
            "total_unrealized_pnl": float(self.total_unrealized_pnl),
            "equity": float(self.equity),
            "total_realized_pnl": float(self.total_realized_pnl),
            "total_commission": float(self.total_commission),
            "total_return_pct": float(self.total_return_pct),
            "max_drawdown_pct": float(self.max_drawdown_pct),
            "open_positions_count": len(self.open_positions),
            "total_trades": len(self.filled_orders),
            "created_at": self.created_at.isoformat(),
        }


class PaperTradingEngine:
    """Simulates trade execution for paper trading.

    Accepts TradingSignal and RiskAssessment inputs, opens/closes
    virtual positions, and tracks full P&L without touching the exchange.

    Args:
        initial_balance: Starting USDT balance.
        risk_manager_factory: Callable that creates a RiskManager for
            a given portfolio value and open positions.
    """

    def __init__(self, initial_balance: float = 100_000.0) -> None:
        self._portfolio = PaperPortfolio(
            initial_balance=Decimal(str(initial_balance))
        )

    @property
    def portfolio(self) -> PaperPortfolio:
        """Return the current portfolio state."""
        return self._portfolio

    def execute_signal(
        self,
        signal: TradingSignal,
        assessment: RiskAssessment,
        current_price: Decimal,
    ) -> Order | None:
        """Execute a paper trade based on a signal and risk assessment.

        Args:
            signal: The trading signal to act on.
            assessment: Risk assessment with sizing parameters.
            current_price: Current market price for fill simulation.

        Returns:
            The filled Order entity, or None if rejected.
        """
        if not assessment.is_tradeable:
            logger.info(
                "Skipping paper trade — not tradeable",
                reason=assessment.rejection_reason,
            )
            return None

        side = (
            OrderSide.BUY
            if signal.direction == SignalDirection.LONG
            else OrderSide.SELL
        )
        position_side = (
            PositionSide.LONG
            if signal.direction == SignalDirection.LONG
            else PositionSide.SHORT
        )

        # Simulate market fill at current price + taker fee
        commission = assessment.position_size_usd * TAKER_FEE
        fill_price = current_price

        # Check if we have enough cash
        margin_required = assessment.position_size_usd / assessment.leverage
        if margin_required + commission > self._portfolio.cash_balance:
            logger.warning(
                "Insufficient cash for paper trade",
                required=float(margin_required + commission),
                available=float(self._portfolio.cash_balance),
            )
            return None

        # Create and fill an order
        order = Order(
            symbol=signal.symbol,
            side=side,
            order_type=OrderType.MARKET,
            quantity=assessment.position_size_contracts,
            leverage=assessment.leverage,
            strategy_id=signal.id,
        )
        order.status = OrderStatus.FILLED
        order.filled_quantity = order.quantity
        order.average_fill_price = fill_price
        order.commission = commission

        # Deduct margin + commission from cash
        self._portfolio.cash_balance -= margin_required + commission
        self._portfolio.total_commission += commission

        # Open position
        position = Position(
            symbol=signal.symbol,
            side=position_side,
            quantity=assessment.position_size_contracts,
            entry_price=fill_price,
            leverage=assessment.leverage,
            stop_loss_price=assessment.stop_loss_price,
            take_profit_price=assessment.take_profit_price,
            strategy_id=signal.id,
            commission=commission,
        )
        position.current_price = fill_price

        self._portfolio.open_positions.append(position)
        self._portfolio.filled_orders.append(order)
        self._portfolio.update_peak()

        logger.info(
            "Paper trade opened",
            symbol=signal.symbol,
            side=side.value,
            price=float(fill_price),
            size_usd=float(assessment.position_size_usd),
            commission=float(commission),
        )
        return order

    def update_prices(self, prices: dict[str, Decimal]) -> None:
        """Update current prices for all open positions.

        Checks stop-loss and take-profit levels and closes positions
        when triggered.

        Args:
            prices: Dict mapping symbol → current price.
        """
        closed = []
        for position in self._portfolio.open_positions:
            price = prices.get(position.symbol)
            if price is None:
                continue

            position.update_price(price)
            self._portfolio.update_peak()

            # Check stop-loss
            if self._should_stop(position, price):
                logger.info(
                    "Stop-loss triggered",
                    symbol=position.symbol,
                    side=position.side.value,
                    price=float(price),
                )
                self._close_position(position, price, "stop_loss")
                closed.append(position)
                continue

            # Check take-profit
            if self._should_take_profit(position, price):
                logger.info(
                    "Take-profit triggered",
                    symbol=position.symbol,
                    side=position.side.value,
                    price=float(price),
                )
                self._close_position(position, price, "take_profit")
                closed.append(position)

        for pos in closed:
            if pos in self._portfolio.open_positions:
                self._portfolio.open_positions.remove(pos)
                self._portfolio.closed_positions.append(pos)

    def close_position(self, position_id: str, current_price: Decimal) -> bool:
        """Manually close a position at the given price.

        Args:
            position_id: UUID of the position to close.
            current_price: Current market price for fill.

        Returns:
            True if the position was found and closed.
        """
        for position in self._portfolio.open_positions:
            if position.id == position_id:
                self._close_position(position, current_price, "manual")
                self._portfolio.open_positions.remove(position)
                self._portfolio.closed_positions.append(position)
                return True
        return False

    def _close_position(
        self, position: Position, exit_price: Decimal, reason: str
    ) -> None:
        """Apply closing logic to a position and return margin to cash."""
        position.update_price(exit_price)
        close_commission = (exit_price * position.quantity) * TAKER_FEE
        realized_pnl = position.unrealized_pnl - close_commission
        position.realized_pnl = realized_pnl
        position.commission += close_commission
        position.status = PositionStatus.CLOSED
        position.closed_at = datetime.utcnow()

        # Return margin + P&L to cash
        margin_returned = (position.entry_price * position.quantity) / position.leverage
        self._portfolio.cash_balance += margin_returned + realized_pnl
        self._portfolio.total_realized_pnl += realized_pnl
        self._portfolio.total_commission += close_commission

        logger.info(
            "Position closed",
            symbol=position.symbol,
            reason=reason,
            realized_pnl=float(realized_pnl),
            exit_price=float(exit_price),
        )

    @staticmethod
    def _should_stop(position: Position, price: Decimal) -> bool:
        """Check if stop-loss should be triggered."""
        if position.stop_loss_price is None:
            return False
        if position.side == PositionSide.LONG:
            return price <= position.stop_loss_price
        return price >= position.stop_loss_price

    @staticmethod
    def _should_take_profit(position: Position, price: Decimal) -> bool:
        """Check if take-profit should be triggered."""
        if position.take_profit_price is None:
            return False
        if position.side == PositionSide.LONG:
            return price >= position.take_profit_price
        return price <= position.take_profit_price
