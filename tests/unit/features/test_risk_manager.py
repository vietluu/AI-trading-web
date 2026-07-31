"""Unit tests for the risk management calculator."""

from __future__ import annotations

from decimal import Decimal

from src.core.domain.entities.signal import TradingSignal
from src.core.domain.value_objects.enums import (
    SignalDirection,
    SignalStrength,
    Timeframe,
)
from src.features.risk_management.calculators.risk_manager import RiskManager


def make_signal(
    direction: SignalDirection = SignalDirection.LONG,
    confidence: float = 0.8,
    entry: Decimal = Decimal("50000"),
    sl: Decimal = Decimal("49000"),
    tp: Decimal = Decimal("52000"),
) -> TradingSignal:
    return TradingSignal(
        symbol="BTC-USDT-SWAP",
        direction=direction,
        strength=SignalStrength.STRONG,
        timeframe=Timeframe.H4,
        entry_price=entry,
        stop_loss_price=sl,
        take_profit_price=tp,
        confidence_score=confidence,
        source="test",
    )


class TestRiskManager:
    """Tests for RiskManager risk assessment logic."""

    def test_valid_long_signal_approved(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("10000"))
        signal = make_signal()
        result = rm.assess(signal, current_price=Decimal("50000"))
        assert result.is_tradeable is True
        assert result.position_size_usd > Decimal("0")

    def test_low_confidence_rejected(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("10000"))
        signal = make_signal(confidence=0.3)
        result = rm.assess(signal, current_price=Decimal("50000"))
        assert result.is_tradeable is False
        assert "confidence" in result.rejection_reason.lower()

    def test_neutral_signal_rejected(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("10000"))
        signal = make_signal(direction=SignalDirection.NEUTRAL, sl=Decimal("49000"), tp=Decimal("51000"))
        result = rm.assess(signal, current_price=Decimal("50000"))
        assert result.is_tradeable is False

    def test_poor_risk_reward_rejected(self) -> None:
        # Only 1:0.5 risk reward (stop is far, TP is close)
        rm = RiskManager(portfolio_value_usd=Decimal("10000"))
        signal = make_signal(
            sl=Decimal("48000"),  # 2000 risk
            tp=Decimal("51000"),  # 1000 reward → R:R = 0.5
        )
        result = rm.assess(signal, current_price=Decimal("50000"))
        assert result.is_tradeable is False
        assert "risk-reward" in result.rejection_reason.lower()

    def test_position_size_within_max_limit(self) -> None:
        portfolio = Decimal("10000")
        rm = RiskManager(portfolio_value_usd=portfolio)
        signal = make_signal()
        result = rm.assess(signal, current_price=Decimal("50000"))
        from src.core.config import get_settings

        max_size = portfolio * Decimal(str(get_settings().trading.max_position_size_pct))
        assert result.position_size_usd <= max_size

    def test_kelly_fraction_positive(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("10000"))
        signal = make_signal()
        result = rm.assess(signal, current_price=Decimal("50000"), win_rate=0.55)
        assert result.kelly_fraction >= Decimal("0")

    def test_drawdown_check_breached(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("8000"))  # 20% below initial
        exceeded = not rm.check_portfolio_drawdown(initial_value=Decimal("10000"))
        assert exceeded  # 20% > 15% max drawdown → should be halted

    def test_drawdown_check_within_limit(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("9200"))  # 8% below initial
        within_limit = rm.check_portfolio_drawdown(initial_value=Decimal("10000"))
        assert within_limit  # 8% < 15% max drawdown → OK

    def test_rejection_with_zero_stop_distance(self) -> None:
        rm = RiskManager(portfolio_value_usd=Decimal("10000"))
        signal = make_signal(sl=Decimal("50000"))  # SL == entry → zero distance
        result = rm.assess(signal, current_price=Decimal("50000"))
        assert result.is_tradeable is False
