"""Unit tests for the backtesting engine."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from src.core.domain.entities.market_data import OHLCV
from src.core.domain.value_objects.enums import Timeframe
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer
from src.features.backtesting.engine.backtesting_engine import BacktestingEngine


def make_bars(count: int = 300, base_price: float = 50000.0) -> list[OHLCV]:
    """Generate synthetic OHLCV bars for testing."""
    import math

    bars = []
    base_ts = datetime(2024, 1, 1)
    price = base_price

    for i in range(count):
        # Simple sinusoidal price movement for testability
        cycle = math.sin(i / 20.0) * 1000
        noise = (i % 7 - 3) * 50  # deterministic "noise"
        price = max(1000.0, base_price + cycle + noise)

        open_price = Decimal(str(round(price - 50, 2)))
        close_price = Decimal(str(round(price + 50, 2)))
        high_price = max(open_price, close_price) + Decimal("100")
        low_price = min(open_price, close_price) - Decimal("100")

        bars.append(
            OHLCV(
                symbol="BTC-USDT-SWAP",
                timeframe=Timeframe.H4,
                timestamp=base_ts + timedelta(hours=4 * i),
                open=open_price,
                high=high_price,
                low=low_price,
                close=close_price,
                volume=Decimal(str(100 + i % 50)),
            )
        )
    return bars


class TestBacktestingEngine:
    """Tests for the BacktestingEngine."""

    def _make_engine(self, **kwargs) -> BacktestingEngine:
        ic = kwargs.pop("initial_capital", 10_000.0)
        return BacktestingEngine(
            technical_analyzer=TechnicalAnalyzer(),
            initial_capital=ic,
            **kwargs,
        )

    def test_run_produces_result(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        assert result is not None
        assert result.initial_capital == 10_000.0

    def test_result_has_equity_curve(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        assert len(result.equity_curve) > 0
        assert "timestamp" in result.equity_curve[0]
        assert "equity" in result.equity_curve[0]

    def test_trade_counts_consistent(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        assert result.total_trades == result.winning_trades + result.losing_trades

    def test_win_rate_in_range(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        if result.total_trades > 0:
            assert 0.0 <= result.win_rate <= 1.0

    def test_insufficient_data_raises(self) -> None:
        engine = self._make_engine()
        bars = make_bars(30)  # Too few bars
        with pytest.raises(ValueError, match="at least"):
            engine.run(bars)

    def test_summary_has_required_fields(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        summary = result.to_summary()
        required = {
            "id", "strategy_name", "symbol", "initial_capital",
            "final_capital", "total_return_pct", "total_trades",
            "win_rate", "sharpe_ratio", "max_drawdown_pct",
        }
        assert required.issubset(set(summary.keys()))

    def test_profit_factor_positive(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        # Profit factor should be non-negative
        assert result.profit_factor >= 0

    def test_max_drawdown_non_negative(self) -> None:
        engine = self._make_engine()
        bars = make_bars(300)
        result = engine.run(bars)
        assert result.max_drawdown_pct >= 0

    def test_backtest_respects_capital(self) -> None:
        """Final capital should be non-negative."""
        engine = self._make_engine(initial_capital=5000.0)
        bars = make_bars(300)
        result = engine.run(bars)
        assert result.final_capital >= 0
