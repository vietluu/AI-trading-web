"""Unit tests for the paper trading engine."""

from __future__ import annotations

from decimal import Decimal

from src.core.domain.entities.signal import TradingSignal
from src.core.domain.value_objects.enums import (
    PositionSide,
    SignalDirection,
    SignalStrength,
    Timeframe,
)
from src.features.paper_trading.engine.paper_trading_engine import PaperTradingEngine
from src.features.risk_management.calculators.risk_manager import RiskAssessment


def make_signal(direction: SignalDirection = SignalDirection.LONG) -> TradingSignal:
    if direction == SignalDirection.LONG:
        sl = Decimal("49000")
        tp = Decimal("52000")
    else:
        sl = Decimal("51000")
        tp = Decimal("48000")
    return TradingSignal(
        symbol="BTC-USDT-SWAP",
        direction=direction,
        strength=SignalStrength.STRONG,
        timeframe=Timeframe.H4,
        entry_price=Decimal("50000"),
        stop_loss_price=sl,
        take_profit_price=tp,
        confidence_score=0.85,
        source="test",
    )


def make_assessment(
    tradeable: bool = True,
    size_usd: Decimal = Decimal("500"),
    sl: Decimal = Decimal("49000"),
    tp: Decimal = Decimal("52000"),
) -> RiskAssessment:
    return RiskAssessment(
        is_tradeable=tradeable,
        position_size_usd=size_usd,
        position_size_contracts=size_usd / Decimal("50000"),
        max_loss_usd=Decimal("10"),
        stop_loss_price=sl,
        take_profit_price=tp,
        leverage=1,
        risk_reward_ratio=Decimal("2"),
    )


class TestPaperTradingEngine:
    """Tests for the PaperTradingEngine."""

    def test_initial_balance(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        assert engine.portfolio.initial_balance == Decimal("10000")
        assert engine.portfolio.cash_balance == Decimal("10000")
        assert engine.portfolio.equity == Decimal("10000")

    def test_execute_long_signal(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        signal = make_signal(SignalDirection.LONG)
        assessment = make_assessment()
        order = engine.execute_signal(signal, assessment, Decimal("50000"))
        assert order is not None
        assert len(engine.portfolio.open_positions) == 1
        assert engine.portfolio.open_positions[0].side == PositionSide.LONG

    def test_execute_short_signal(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        signal = make_signal(SignalDirection.SHORT)
        assessment = make_assessment(
            sl=Decimal("51000"),
            tp=Decimal("48000"),
        )
        order = engine.execute_signal(signal, assessment, Decimal("50000"))
        assert order is not None
        assert engine.portfolio.open_positions[0].side == PositionSide.SHORT

    def test_rejected_trade_not_opened(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        signal = make_signal()
        assessment = make_assessment(tradeable=False)
        order = engine.execute_signal(signal, assessment, Decimal("50000"))
        assert order is None
        assert len(engine.portfolio.open_positions) == 0

    def test_stop_loss_triggered(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        signal = make_signal(SignalDirection.LONG)
        assessment = make_assessment(sl=Decimal("49000"), tp=Decimal("52000"))
        engine.execute_signal(signal, assessment, Decimal("50000"))
        assert len(engine.portfolio.open_positions) == 1

        # Trigger stop loss
        engine.update_prices({"BTC-USDT-SWAP": Decimal("48500")})
        assert len(engine.portfolio.open_positions) == 0
        assert len(engine.portfolio.closed_positions) == 1

    def test_take_profit_triggered(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        signal = make_signal(SignalDirection.LONG)
        assessment = make_assessment(sl=Decimal("49000"), tp=Decimal("52000"))
        engine.execute_signal(signal, assessment, Decimal("50000"))

        # Trigger take profit
        engine.update_prices({"BTC-USDT-SWAP": Decimal("52500")})
        assert len(engine.portfolio.open_positions) == 0
        assert engine.portfolio.total_realized_pnl > Decimal("0")

    def test_commission_deducted(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        initial_cash = engine.portfolio.cash_balance
        signal = make_signal()
        assessment = make_assessment(size_usd=Decimal("1000"))
        engine.execute_signal(signal, assessment, Decimal("50000"))
        # Cash should be less than initial (margin + commission deducted)
        assert engine.portfolio.cash_balance < initial_cash
        assert engine.portfolio.total_commission > Decimal("0")

    def test_manual_close(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        signal = make_signal()
        assessment = make_assessment()
        engine.execute_signal(signal, assessment, Decimal("50000"))
        position_id = engine.portfolio.open_positions[0].id

        result = engine.close_position(position_id, Decimal("50500"))
        assert result is True
        assert len(engine.portfolio.open_positions) == 0

    def test_portfolio_summary_fields(self) -> None:
        engine = PaperTradingEngine(initial_balance=10_000.0)
        summary = engine.portfolio.to_summary()
        expected_keys = {
            "initial_balance", "cash_balance", "equity",
            "total_realized_pnl", "total_return_pct",
            "max_drawdown_pct", "open_positions_count", "total_trades",
        }
        assert expected_keys.issubset(set(summary.keys()))
