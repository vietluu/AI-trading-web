"""Risk management calculator.

Implements position sizing using the Kelly Criterion (fractional),
fixed percentage risk, and ATR-based sizing methods.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from src.core.config import get_settings
from src.core.domain.entities.signal import TradingSignal
from src.core.domain.entities.trading import Position
from src.core.domain.value_objects.enums import SignalDirection
from src.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class RiskAssessment:
    """Result of a risk management evaluation.

    Attributes:
        is_tradeable: Whether the signal meets risk criteria.
        position_size_usd: Recommended position size in USD.
        position_size_contracts: Contracts (for futures).
        max_loss_usd: Maximum acceptable loss for this trade.
        stop_loss_price: Recommended stop-loss price.
        take_profit_price: Recommended take-profit price.
        leverage: Recommended leverage.
        rejection_reason: Reason for rejection if not tradeable.
        risk_reward_ratio: Expected risk:reward.
        kelly_fraction: Kelly Criterion optimal fraction.
    """

    is_tradeable: bool
    position_size_usd: Decimal
    position_size_contracts: Decimal
    max_loss_usd: Decimal
    stop_loss_price: Decimal
    take_profit_price: Decimal
    leverage: int
    rejection_reason: str = ""
    risk_reward_ratio: Decimal = Decimal("0")
    kelly_fraction: Decimal = Decimal("0")


class RiskManager:
    """Evaluates and enforces trading risk constraints.

    Checks:
    1. Maximum portfolio drawdown
    2. Maximum single position size
    3. Minimum risk-reward ratio
    4. Open position concentration
    5. Signal confidence threshold

    Args:
        portfolio_value_usd: Current total portfolio value.
        open_positions: Currently open positions.
    """

    MIN_RISK_REWARD = Decimal("1.5")
    MIN_CONFIDENCE = 0.55
    MIN_POSITION_SIZE_USD = Decimal("10")

    def __init__(
        self,
        portfolio_value_usd: Decimal,
        open_positions: list[Position] | None = None,
    ) -> None:
        self._portfolio = portfolio_value_usd
        self._open_positions = open_positions or []
        self._settings = get_settings().trading

    def assess(
        self,
        signal: TradingSignal,
        current_price: Decimal,
        win_rate: float = 0.5,
    ) -> RiskAssessment:
        """Assess risk for a potential trade based on a signal.

        Args:
            signal: The trading signal to evaluate.
            current_price: Current market price.
            win_rate: Historical win rate for Kelly sizing (0.0–1.0).

        Returns:
            RiskAssessment with sizing recommendations.
        """
        # 1. Confidence threshold check
        if signal.confidence_score < self.MIN_CONFIDENCE:
            return self._reject(
                f"Signal confidence {signal.confidence_score:.2f} below "
                f"minimum {self.MIN_CONFIDENCE:.2f}"
            )

        # 2. Skip neutral signals
        if signal.direction == SignalDirection.NEUTRAL:
            return self._reject("Signal direction is NEUTRAL — no trade")

        # 3. Minimum risk-reward check
        rr = signal.risk_reward_ratio
        if rr < self.MIN_RISK_REWARD:
            return self._reject(
                f"Risk-reward ratio {float(rr):.2f} below minimum {float(self.MIN_RISK_REWARD):.2f}"
            )

        # 4. Check open position concentration
        total_exposure = sum(p.notional_value for p in self._open_positions if p.is_open)
        max_exposure = self._portfolio * Decimal(str(self._settings.max_position_size_pct)) * 5
        if total_exposure >= max_exposure:
            return self._reject(
                f"Total open exposure ${float(total_exposure):,.2f} at maximum allowed"
            )

        # 5. Calculate position size (fixed fractional risk)
        risk_amount = self._portfolio * Decimal(str(self._settings.risk_per_trade_pct))
        stop_distance = abs(current_price - signal.stop_loss_price)
        if stop_distance <= Decimal("0"):
            return self._reject("Invalid stop loss — zero distance from entry")

        position_size_usd = min(
            risk_amount / stop_distance * current_price,
            self._portfolio * Decimal(str(self._settings.max_position_size_pct)),
        )

        if position_size_usd < self.MIN_POSITION_SIZE_USD:
            return self._reject(
                f"Position size ${float(position_size_usd):.2f} below minimum "
                f"${float(self.MIN_POSITION_SIZE_USD):.2f}"
            )

        # 6. Kelly fraction (informational)
        kelly_fraction = self._kelly_fraction(
            win_rate=win_rate,
            win_pct=float(signal.take_profit_price / signal.entry_price - 1),
            loss_pct=float(signal.entry_price / signal.stop_loss_price - 1),
        )

        position_size_contracts = position_size_usd / current_price

        logger.info(
            "Risk assessment APPROVED",
            symbol=signal.symbol,
            position_usd=float(position_size_usd),
            max_loss=float(risk_amount),
            rr=float(rr),
            kelly=float(kelly_fraction),
        )

        return RiskAssessment(
            is_tradeable=True,
            position_size_usd=position_size_usd.quantize(Decimal("0.01")),
            position_size_contracts=position_size_contracts.quantize(Decimal("0.0001")),
            max_loss_usd=risk_amount.quantize(Decimal("0.01")),
            stop_loss_price=signal.stop_loss_price,
            take_profit_price=signal.take_profit_price,
            leverage=self._settings.default_leverage,
            risk_reward_ratio=rr,
            kelly_fraction=kelly_fraction,
        )

    def check_portfolio_drawdown(self, initial_value: Decimal) -> bool:
        """Check if current portfolio has hit the maximum drawdown limit.

        Args:
            initial_value: Portfolio value at strategy start.

        Returns:
            True if portfolio is still within drawdown limits.
        """
        drawdown = (initial_value - self._portfolio) / initial_value
        max_drawdown = Decimal(str(self._settings.max_drawdown_pct))
        if drawdown >= max_drawdown:
            logger.warning(
                "Max drawdown breached — halting trading",
                drawdown_pct=float(drawdown * 100),
                threshold_pct=float(max_drawdown * 100),
            )
            return False
        return True

    @staticmethod
    def _kelly_fraction(win_rate: float, win_pct: float, loss_pct: float) -> Decimal:
        """Compute the fractional Kelly criterion bet size.

        Kelly formula: f* = (W*R - L) / R
        where W = win rate, L = loss rate, R = win/loss ratio.

        We use half-Kelly for conservatism.
        """
        if loss_pct <= 0 or win_pct <= 0:
            return Decimal("0")

        r = win_pct / loss_pct  # win/loss ratio
        kelly = (win_rate * r - (1 - win_rate)) / r
        half_kelly = max(0.0, kelly / 2)
        return Decimal(str(round(half_kelly, 4)))

    @staticmethod
    def _reject(reason: str) -> RiskAssessment:
        """Build a rejection RiskAssessment."""
        logger.info("Risk assessment REJECTED", reason=reason)
        return RiskAssessment(
            is_tradeable=False,
            position_size_usd=Decimal("0"),
            position_size_contracts=Decimal("0"),
            max_loss_usd=Decimal("0"),
            stop_loss_price=Decimal("0"),
            take_profit_price=Decimal("0"),
            leverage=1,
            rejection_reason=reason,
        )
