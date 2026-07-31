"""Trading signal API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.core.domain.value_objects.enums import Timeframe
from src.core.logging import get_logger
from src.features.ai_analysis.analyzers.ai_market_analyzer import AIMarketAnalyzer
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer
from src.features.market_data.collectors.market_data_collector import MarketDataCollector
from src.features.signals.generators.signal_generator import SignalGenerator
from src.infrastructure.cache.redis_client import CacheClient
from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

router = APIRouter()
logger = get_logger(__name__)


def _get_signal_generator() -> SignalGenerator:
    """Dependency factory for SignalGenerator."""
    return SignalGenerator(
        market_collector=MarketDataCollector(
            okx_client=OKXRestClient(),
            cache=CacheClient(),
        ),
        technical_analyzer=TechnicalAnalyzer(),
        ai_analyzer=AIMarketAnalyzer(),
    )


@router.post(
    "/generate/{symbol}",
    summary="Generate AI-powered trading signal",
)
async def generate_signal(
    symbol: str,
    timeframe: Timeframe = Query(default=Timeframe.H4),
    use_ai: bool = Query(default=False, description="Use AI analysis (requires OpenAI API key)"),
) -> dict[str, Any]:
    """Generate a trading signal for a symbol.

    Supports two modes:
    - **Technical only** (use_ai=false): Fast rule-based signal from RSI, MACD, EMA.
    - **AI analysis** (use_ai=true): Full GPT-4 analysis combining technical,
      news, and on-chain data. Requires OPENAI_API_KEY.

    Args:
        symbol: Instrument ID (e.g. BTC-USDT-SWAP).
        timeframe: Analysis timeframe.
        use_ai: Whether to invoke the OpenAI analysis pipeline.

    Returns:
        Trading signal with direction, entry, stop-loss, take-profit, and reasoning.
    """
    generator = _get_signal_generator()

    try:
        if use_ai:
            signal = await generator.generate(symbol=symbol, timeframe=timeframe)
        else:
            signal = await generator.generate_technical_only(symbol=symbol, timeframe=timeframe)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Signal generation failed", symbol=symbol, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {exc}") from exc

    if signal is None:
        raise HTTPException(status_code=204, detail="No clear signal detected")

    return {
        "id": signal.id,
        "symbol": signal.symbol,
        "direction": signal.direction.value,
        "strength": signal.strength.value,
        "timeframe": signal.timeframe.value,
        "entry_price": float(signal.entry_price),
        "stop_loss_price": float(signal.stop_loss_price),
        "take_profit_price": float(signal.take_profit_price),
        "risk_reward_ratio": float(signal.risk_reward_ratio),
        "confidence_score": signal.confidence_score,
        "source": signal.source,
        "reasoning": signal.reasoning,
        "is_actionable": signal.is_actionable,
        "created_at": signal.created_at.isoformat(),
        "expires_at": signal.expires_at.isoformat() if signal.expires_at else None,
        "technical_indicators": {
            k: round(v, 4) for k, v in signal.technical_indicators.items()
        },
    }
