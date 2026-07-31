"""Technical indicator calculations for trading analysis.

Uses the ``ta`` library for standard indicators plus custom
implementations for specialized metrics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import ta
import ta.momentum
import ta.trend
import ta.volatility
import ta.volume

from src.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class TechnicalIndicators:
    """Container for all computed technical indicator values.

    All values are floats or None when insufficient data is available.

    Attributes:
        rsi_14: Relative Strength Index (14-period).
        macd: MACD line value.
        macd_signal: MACD signal line value.
        macd_histogram: MACD histogram value.
        bb_upper: Bollinger Band upper boundary.
        bb_middle: Bollinger Band middle (SMA-20).
        bb_lower: Bollinger Band lower boundary.
        bb_pct_b: %B position within Bollinger Bands.
        ema_9: Exponential Moving Average (9-period).
        ema_21: Exponential Moving Average (21-period).
        ema_50: Exponential Moving Average (50-period).
        ema_200: Exponential Moving Average (200-period).
        sma_20: Simple Moving Average (20-period).
        sma_50: Simple Moving Average (50-period).
        atr_14: Average True Range (14-period).
        stoch_k: Stochastic %K.
        stoch_d: Stochastic %D.
        volume_sma_20: 20-period volume SMA.
        volume_ratio: Current volume / volume SMA.
        adx: Average Directional Index (14-period).
        plus_di: +DI directional indicator.
        minus_di: -DI directional indicator.
        cci_20: Commodity Channel Index (20-period).
        mfi_14: Money Flow Index (14-period).
        obv: On-Balance Volume.
        vwap: Volume-Weighted Average Price.
        price_change_pct: Percentage price change from previous bar.
        volatility_pct: Annualized historical volatility.
    """

    rsi_14: float | None = None
    macd: float | None = None
    macd_signal: float | None = None
    macd_histogram: float | None = None
    bb_upper: float | None = None
    bb_middle: float | None = None
    bb_lower: float | None = None
    bb_pct_b: float | None = None
    ema_9: float | None = None
    ema_21: float | None = None
    ema_50: float | None = None
    ema_200: float | None = None
    sma_20: float | None = None
    sma_50: float | None = None
    atr_14: float | None = None
    stoch_k: float | None = None
    stoch_d: float | None = None
    volume_sma_20: float | None = None
    volume_ratio: float | None = None
    adx: float | None = None
    plus_di: float | None = None
    minus_di: float | None = None
    cci_20: float | None = None
    mfi_14: float | None = None
    obv: float | None = None
    vwap: float | None = None
    price_change_pct: float | None = None
    volatility_pct: float | None = None

    def to_dict(self) -> dict[str, float]:
        """Return non-None indicator values as a dict."""
        return {k: v for k, v in self.__dict__.items() if v is not None}


class TechnicalAnalyzer:
    """Computes technical indicators from OHLCV DataFrames.

    Requires a DataFrame with columns: open, high, low, close, volume.
    The DataFrame must be indexed by timestamp and sorted ascending.
    """

    MIN_BARS = 50  # Minimum bars required for reliable indicator computation

    def compute(self, df: pd.DataFrame) -> TechnicalIndicators:
        """Compute all technical indicators for a given OHLCV DataFrame.

        Args:
            df: OHLCV DataFrame indexed by timestamp, ascending.

        Returns:
            TechnicalIndicators with all computed values.

        Raises:
            ValueError: If the DataFrame has insufficient rows.
        """
        if len(df) < self.MIN_BARS:
            raise ValueError(
                f"Need at least {self.MIN_BARS} bars for reliable indicators, "
                f"got {len(df)}"
            )

        close = df["close"]
        high = df["high"]
        low = df["low"]
        volume = df["volume"]

        result = TechnicalIndicators()

        try:
            result.rsi_14 = self._safe_float(
                ta.momentum.RSIIndicator(close, window=14).rsi().iloc[-1]
            )
        except Exception:
            pass

        try:
            macd = ta.trend.MACD(close)
            result.macd = self._safe_float(macd.macd().iloc[-1])
            result.macd_signal = self._safe_float(macd.macd_signal().iloc[-1])
            result.macd_histogram = self._safe_float(macd.macd_diff().iloc[-1])
        except Exception:
            pass

        try:
            bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
            result.bb_upper = self._safe_float(bb.bollinger_hband().iloc[-1])
            result.bb_middle = self._safe_float(bb.bollinger_mavg().iloc[-1])
            result.bb_lower = self._safe_float(bb.bollinger_lband().iloc[-1])
            result.bb_pct_b = self._safe_float(bb.bollinger_pband().iloc[-1])
        except Exception:
            pass

        try:
            result.ema_9 = self._safe_float(
                ta.trend.EMAIndicator(close, window=9).ema_indicator().iloc[-1]
            )
            result.ema_21 = self._safe_float(
                ta.trend.EMAIndicator(close, window=21).ema_indicator().iloc[-1]
            )
            result.ema_50 = self._safe_float(
                ta.trend.EMAIndicator(close, window=50).ema_indicator().iloc[-1]
            )
            if len(df) >= 200:
                result.ema_200 = self._safe_float(
                    ta.trend.EMAIndicator(close, window=200).ema_indicator().iloc[-1]
                )
            result.sma_20 = self._safe_float(
                ta.trend.SMAIndicator(close, window=20).sma_indicator().iloc[-1]
            )
            result.sma_50 = self._safe_float(
                ta.trend.SMAIndicator(close, window=50).sma_indicator().iloc[-1]
            )
        except Exception:
            pass

        try:
            result.atr_14 = self._safe_float(
                ta.volatility.AverageTrueRange(high, low, close, window=14).average_true_range().iloc[-1]
            )
        except Exception:
            pass

        try:
            stoch = ta.momentum.StochasticOscillator(high, low, close, window=14, smooth_window=3)
            result.stoch_k = self._safe_float(stoch.stoch().iloc[-1])
            result.stoch_d = self._safe_float(stoch.stoch_signal().iloc[-1])
        except Exception:
            pass

        try:
            vol_sma = volume.rolling(window=20).mean()
            result.volume_sma_20 = self._safe_float(vol_sma.iloc[-1])
            if result.volume_sma_20 and result.volume_sma_20 > 0:
                result.volume_ratio = self._safe_float(volume.iloc[-1] / result.volume_sma_20)
        except Exception:
            pass

        try:
            adx_ind = ta.trend.ADXIndicator(high, low, close, window=14)
            result.adx = self._safe_float(adx_ind.adx().iloc[-1])
            result.plus_di = self._safe_float(adx_ind.adx_pos().iloc[-1])
            result.minus_di = self._safe_float(adx_ind.adx_neg().iloc[-1])
        except Exception:
            pass

        try:
            result.cci_20 = self._safe_float(
                ta.trend.CCIIndicator(high, low, close, window=20).cci().iloc[-1]
            )
        except Exception:
            pass

        try:
            result.mfi_14 = self._safe_float(
                ta.volume.MFIIndicator(high, low, close, volume, window=14).money_flow_index().iloc[-1]
            )
        except Exception:
            pass

        try:
            result.obv = self._safe_float(
                ta.volume.OnBalanceVolumeIndicator(close, volume).on_balance_volume().iloc[-1]
            )
        except Exception:
            pass

        try:
            # VWAP (intraday approximation using entire dataset)
            typical_price = (high + low + close) / 3
            result.vwap = self._safe_float(
                (typical_price * volume).cumsum().iloc[-1] / volume.cumsum().iloc[-1]
            )
        except Exception:
            pass

        try:
            result.price_change_pct = self._safe_float(
                (close.iloc[-1] - close.iloc[-2]) / close.iloc[-2] * 100
            )
        except Exception:
            pass

        try:
            log_returns = np.log(close / close.shift(1)).dropna()
            result.volatility_pct = self._safe_float(
                float(log_returns.std()) * np.sqrt(365 * 24) * 100
            )
        except Exception:
            pass

        logger.debug("Computed technical indicators", non_null=len(result.to_dict()))
        return result

    @staticmethod
    def _safe_float(value: Any) -> float | None:
        """Convert a value to float, returning None on NaN or error."""
        try:
            f = float(value)
            return None if (f != f) else f  # NaN check
        except (TypeError, ValueError):
            return None
