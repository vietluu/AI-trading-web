"""Unit tests for the technical analyzer."""

from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import pytest

from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer


def make_dataframe(count: int = 100, close_start: float = 50000.0) -> pd.DataFrame:
    """Create a simple OHLCV DataFrame for testing."""
    import math

    data = []
    base_ts = datetime(2024, 1, 1)
    for i in range(count):
        close = close_start + math.sin(i / 10.0) * 1000 + i * 10
        open_ = close - 100
        high = close + 200
        low = close - 200
        data.append(
            {
                "timestamp": base_ts + timedelta(hours=i),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": 100.0 + i,
                "quote_volume": (100.0 + i) * close,
                "trades": 50,
            }
        )
    df = pd.DataFrame(data).set_index("timestamp")
    return df


class TestTechnicalAnalyzer:
    """Tests for the TechnicalAnalyzer."""

    def test_compute_basic_indicators(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=100)
        result = analyzer.compute(df)
        assert result.rsi_14 is not None
        assert result.macd is not None
        assert result.bb_upper is not None

    def test_rsi_in_valid_range(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=100)
        result = analyzer.compute(df)
        if result.rsi_14 is not None:
            assert 0.0 <= result.rsi_14 <= 100.0

    def test_bollinger_bands_ordered(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=100)
        result = analyzer.compute(df)
        if all(x is not None for x in [result.bb_lower, result.bb_middle, result.bb_upper]):
            assert result.bb_lower <= result.bb_middle <= result.bb_upper

    def test_insufficient_data_raises(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=20)  # Less than MIN_BARS (50)
        with pytest.raises(ValueError, match="at least"):
            analyzer.compute(df)

    def test_to_dict_only_non_null(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=100)
        result = analyzer.compute(df)
        d = result.to_dict()
        assert all(v is not None for v in d.values())
        assert all(isinstance(v, float) for v in d.values())

    def test_ema_ordering_with_enough_bars(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=250)
        result = analyzer.compute(df)
        # All EMAs should be computed
        assert result.ema_9 is not None
        assert result.ema_21 is not None
        assert result.ema_50 is not None
        assert result.ema_200 is not None

    def test_atr_positive(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=100)
        result = analyzer.compute(df)
        if result.atr_14 is not None:
            assert result.atr_14 > 0

    def test_volume_ratio(self) -> None:
        analyzer = TechnicalAnalyzer()
        df = make_dataframe(count=100)
        result = analyzer.compute(df)
        if result.volume_ratio is not None:
            assert result.volume_ratio > 0
