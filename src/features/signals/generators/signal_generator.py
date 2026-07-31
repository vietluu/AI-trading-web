"""Trading signal generation service.

Combines technical analysis and AI analysis to produce
actionable TradingSignal domain entities.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from src.core.domain.entities.market_data import OHLCV
from src.core.domain.entities.research import NewsArticle, OnChainMetric, SentimentData
from src.core.domain.entities.signal import TradingSignal
from src.core.domain.value_objects.enums import (
    SignalDirection,
    SignalStrength,
    Timeframe,
)
from src.core.logging import get_logger
from src.features.ai_analysis.analyzers.ai_market_analyzer import AIAnalysisResult, AIMarketAnalyzer
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer
from src.features.market_data.collectors.market_data_collector import MarketDataCollector

logger = get_logger(__name__)


class SignalGenerator:
    """Generates TradingSignal entities from market analysis.

    Orchestrates the full signal pipeline:
    1. Fetch market data
    2. Compute technical indicators
    3. Run AI analysis
    4. Construct a TradingSignal

    Args:
        market_collector: Market data collector.
        technical_analyzer: Technical indicator calculator.
        ai_analyzer: OpenAI-based market analyzer.
        signal_validity_hours: How long generated signals remain valid.
    """

    def __init__(
        self,
        market_collector: MarketDataCollector,
        technical_analyzer: TechnicalAnalyzer,
        ai_analyzer: AIMarketAnalyzer,
        signal_validity_hours: int = 4,
    ) -> None:
        self._market = market_collector
        self._technical = technical_analyzer
        self._ai = ai_analyzer
        self._validity_hours = signal_validity_hours

    async def generate(
        self,
        symbol: str,
        timeframe: Timeframe,
        news: list[NewsArticle] | None = None,
        sentiment: list[SentimentData] | None = None,
        onchain: list[OnChainMetric] | None = None,
    ) -> TradingSignal:
        """Generate a trading signal for a symbol.

        Args:
            symbol: Trading pair symbol (e.g. 'BTC-USDT-SWAP').
            timeframe: Analysis timeframe.
            news: Optional pre-fetched news articles.
            sentiment: Optional pre-fetched sentiment data.
            onchain: Optional pre-fetched on-chain metrics.

        Returns:
            A fully constructed TradingSignal.

        Raises:
            ValueError: If insufficient market data is available.
        """
        logger.info("Generating signal", symbol=symbol, timeframe=timeframe.value)

        # 1. Fetch market data
        bars = await self._market.fetch_ohlcv(symbol, timeframe, limit=250)
        if len(bars) < 50:
            raise ValueError(f"Insufficient data for {symbol}: only {len(bars)} bars available")

        ticker = await self._market.fetch_ticker(symbol)
        current_price = float(ticker.last)

        # 2. Compute technical indicators
        df = self._market.to_dataframe(bars)
        indicators = self._technical.compute(df)

        # 3. Run AI analysis
        ai_result: AIAnalysisResult = await self._ai.analyze(
            symbol=symbol,
            current_price=current_price,
            technical=indicators,
            news=news,
            sentiment=sentiment,
            onchain=onchain,
            timeframe=timeframe.value,
        )

        # 4. Compute entry, stop loss, and take profit prices
        entry_price, stop_loss, take_profit = self._compute_prices(
            current_price=Decimal(str(current_price)),
            direction=ai_result.direction,
            stop_loss_pct=Decimal(str(ai_result.stop_loss_pct)) / Decimal("100"),
            take_profit_pct=Decimal(str(ai_result.take_profit_pct)) / Decimal("100"),
            atr=indicators.atr_14,
        )

        expires_at = datetime.utcnow() + timedelta(hours=self._validity_hours)

        signal = TradingSignal(
            symbol=symbol,
            direction=ai_result.direction,
            strength=ai_result.strength,
            timeframe=timeframe,
            entry_price=entry_price,
            stop_loss_price=stop_loss,
            take_profit_price=take_profit,
            confidence_score=ai_result.confidence_score,
            source="ai_signal_generator",
            reasoning=ai_result.reasoning,
            technical_indicators=indicators.to_dict(),
            ai_analysis_id=ai_result.id,
            expires_at=expires_at,
        )

        logger.info(
            "Signal generated",
            symbol=symbol,
            direction=signal.direction.value,
            confidence=signal.confidence_score,
            rr_ratio=float(signal.risk_reward_ratio),
        )
        return signal

    @staticmethod
    def _compute_prices(
        current_price: Decimal,
        direction: SignalDirection,
        stop_loss_pct: Decimal,
        take_profit_pct: Decimal,
        atr: float | None = None,
    ) -> tuple[Decimal, Decimal, Decimal]:
        """Calculate entry, stop loss, and take profit prices.

        For long signals:
            - entry ≈ current price
            - stop = entry * (1 - stop_loss_pct)
            - tp   = entry * (1 + take_profit_pct)

        For short signals:
            - entry ≈ current price
            - stop = entry * (1 + stop_loss_pct)
            - tp   = entry * (1 - take_profit_pct)

        Args:
            current_price: Latest market price.
            direction: Signal direction.
            stop_loss_pct: Stop loss as fraction (0.02 = 2%).
            take_profit_pct: Take profit as fraction (0.04 = 4%).
            atr: Average True Range value for dynamic adjustment.

        Returns:
            Tuple of (entry_price, stop_loss_price, take_profit_price).
        """
        entry_price = current_price

        if direction == SignalDirection.LONG:
            stop_loss = entry_price * (Decimal("1") - stop_loss_pct)
            take_profit = entry_price * (Decimal("1") + take_profit_pct)
        elif direction == SignalDirection.SHORT:
            stop_loss = entry_price * (Decimal("1") + stop_loss_pct)
            take_profit = entry_price * (Decimal("1") - take_profit_pct)
        else:
            # Neutral — set symmetric stops
            stop_loss = entry_price * (Decimal("1") - stop_loss_pct)
            take_profit = entry_price * (Decimal("1") + take_profit_pct)

        return entry_price, stop_loss, take_profit

    async def generate_technical_only(
        self,
        symbol: str,
        timeframe: Timeframe,
        bars: list[OHLCV] | None = None,
    ) -> TradingSignal | None:
        """Generate a signal using technical analysis only (no AI).

        This is a faster, cheaper alternative that uses rule-based
        signal generation from technical indicators.

        Args:
            symbol: Trading pair.
            timeframe: Analysis timeframe.
            bars: Optional pre-fetched OHLCV bars.

        Returns:
            TradingSignal or None if no clear signal.
        """
        if bars is None:
            bars = await self._market.fetch_ohlcv(symbol, timeframe, limit=250)

        if len(bars) < 50:
            return None

        ticker = await self._market.fetch_ticker(symbol)
        current_price = Decimal(str(ticker.last))
        df = self._market.to_dataframe(bars)
        ind = self._technical.compute(df)

        direction, strength, confidence = self._rules_based_direction(ind)

        from src.core.config import get_settings

        cfg = get_settings().trading
        sl_pct = Decimal(str(cfg.default_stop_loss_pct))
        tp_pct = Decimal(str(cfg.default_take_profit_pct))

        entry, stop_loss, take_profit = self._compute_prices(
            current_price=current_price,
            direction=direction,
            stop_loss_pct=sl_pct,
            take_profit_pct=tp_pct,
            atr=ind.atr_14,
        )

        expires_at = datetime.utcnow() + timedelta(hours=self._validity_hours)

        return TradingSignal(
            symbol=symbol,
            direction=direction,
            strength=strength,
            timeframe=timeframe,
            entry_price=entry,
            stop_loss_price=stop_loss,
            take_profit_price=take_profit,
            confidence_score=confidence,
            source="technical_signal_generator",
            reasoning=self._build_reasoning(ind, direction),
            technical_indicators=ind.to_dict(),
            expires_at=expires_at,
        )

    @staticmethod
    def _rules_based_direction(
        ind: Any,
    ) -> tuple[SignalDirection, SignalStrength, float]:
        """Simple rule-based direction from technical indicators."""
        bullish_signals = 0
        bearish_signals = 0
        total_signals = 0

        # RSI
        if ind.rsi_14 is not None:
            total_signals += 1
            if ind.rsi_14 < 35:
                bullish_signals += 1
            elif ind.rsi_14 > 65:
                bearish_signals += 1

        # MACD
        if ind.macd is not None and ind.macd_signal is not None:
            total_signals += 1
            if ind.macd > ind.macd_signal:
                bullish_signals += 1
            elif ind.macd < ind.macd_signal:
                bearish_signals += 1

        # EMA trend
        if ind.ema_9 is not None and ind.ema_21 is not None:
            total_signals += 1
            if ind.ema_9 > ind.ema_21:
                bullish_signals += 1
            else:
                bearish_signals += 1

        # Bollinger Bands
        if ind.bb_pct_b is not None:
            total_signals += 1
            if ind.bb_pct_b < 0.2:
                bullish_signals += 1
            elif ind.bb_pct_b > 0.8:
                bearish_signals += 1

        # Stochastic
        if ind.stoch_k is not None and ind.stoch_d is not None:
            total_signals += 1
            if ind.stoch_k < 25 and ind.stoch_k > ind.stoch_d:
                bullish_signals += 1
            elif ind.stoch_k > 75 and ind.stoch_k < ind.stoch_d:
                bearish_signals += 1

        if total_signals == 0:
            return SignalDirection.NEUTRAL, SignalStrength.WEAK, 0.3

        bull_ratio = bullish_signals / total_signals
        bear_ratio = bearish_signals / total_signals

        if bull_ratio >= 0.7:
            direction = SignalDirection.LONG
            confidence = bull_ratio
        elif bear_ratio >= 0.7:
            direction = SignalDirection.SHORT
            confidence = bear_ratio
        else:
            direction = SignalDirection.NEUTRAL
            confidence = 0.4

        if confidence >= 0.85:
            strength = SignalStrength.STRONG
        elif confidence >= 0.65:
            strength = SignalStrength.MODERATE
        else:
            strength = SignalStrength.WEAK

        return direction, strength, round(confidence, 2)

    @staticmethod
    def _build_reasoning(ind: Any, direction: SignalDirection) -> str:
        """Build a human-readable reasoning string from indicators."""
        parts = []
        if ind.rsi_14 is not None:
            parts.append(f"RSI(14)={ind.rsi_14:.1f}")
        if ind.macd is not None and ind.macd_signal is not None:
            parts.append(f"MACD={'bullish' if ind.macd > ind.macd_signal else 'bearish'}")
        if ind.bb_pct_b is not None:
            parts.append(f"BB%={ind.bb_pct_b:.2f}")
        if ind.adx is not None:
            parts.append(f"ADX={ind.adx:.1f}")
        return (
            f"Technical analysis ({direction.value.upper()}): "
            + ", ".join(parts)
        )
