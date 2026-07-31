"""Paper trading API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.core.domain.value_objects.enums import Timeframe
from src.core.logging import get_logger
from src.features.ai_analysis.analyzers.ai_market_analyzer import AIMarketAnalyzer
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer
from src.features.market_data.collectors.market_data_collector import MarketDataCollector
from src.features.paper_trading.engine.paper_trading_engine import PaperTradingEngine
from src.features.risk_management.calculators.risk_manager import RiskManager
from src.features.signals.generators.signal_generator import SignalGenerator
from src.infrastructure.cache.redis_client import CacheClient
from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

router = APIRouter()
logger = get_logger(__name__)

# In production this would be stored in a database or Redis.
# For the API layer, we use a module-level singleton for demo purposes.
_engine: PaperTradingEngine | None = None


def _get_engine() -> PaperTradingEngine:
    global _engine
    if _engine is None:
        from src.core.config import get_settings

        settings = get_settings()
        _engine = PaperTradingEngine(
            initial_balance=settings.paper_trading.initial_balance,
        )
    return _engine


class ExecuteSignalRequest(BaseModel):
    """Request body for executing a signal in paper trading."""

    symbol: str = Field(description="Trading pair symbol (e.g. BTC-USDT-SWAP)")
    timeframe: Timeframe = Field(default=Timeframe.H4)


@router.get("/portfolio", summary="Get paper trading portfolio")
async def get_portfolio() -> dict[str, Any]:
    """Return the current paper trading portfolio summary."""
    engine = _get_engine()
    return engine.portfolio.to_summary()


@router.post("/execute", summary="Execute a technical signal in paper trading")
async def execute_signal(request: ExecuteSignalRequest) -> dict[str, Any]:
    """Generate a signal and execute a paper trade.

    Fetches market data, generates a technical signal, runs risk assessment,
    and opens a paper trading position if conditions are met.

    Args:
        request: Symbol and timeframe for signal generation.

    Returns:
        Trade execution result including order and portfolio summary.
    """
    collector = MarketDataCollector(okx_client=OKXRestClient(), cache=CacheClient())
    generator = SignalGenerator(
        market_collector=collector,
        technical_analyzer=TechnicalAnalyzer(),
        ai_analyzer=AIMarketAnalyzer(),
    )
    engine = _get_engine()

    try:
        signal = await generator.generate_technical_only(
            symbol=request.symbol,
            timeframe=request.timeframe,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {exc}") from exc

    if signal is None:
        return {
            "executed": False,
            "reason": "No clear signal detected",
            "portfolio": engine.portfolio.to_summary(),
        }

    # Fetch current price for risk assessment
    try:
        ticker = await collector.fetch_ticker(request.symbol)
        current_price = ticker.last
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch price: {exc}") from exc

    risk_mgr = RiskManager(
        portfolio_value_usd=engine.portfolio.equity,
        open_positions=engine.portfolio.open_positions,
    )
    assessment = risk_mgr.assess(signal=signal, current_price=current_price)

    order = engine.execute_signal(
        signal=signal,
        assessment=assessment,
        current_price=current_price,
    )

    if order is None:
        return {
            "executed": False,
            "reason": assessment.rejection_reason or "Trade rejected by risk manager",
            "portfolio": engine.portfolio.to_summary(),
        }

    return {
        "executed": True,
        "order": {
            "id": order.id,
            "symbol": order.symbol,
            "side": order.side.value,
            "quantity": float(order.quantity),
            "fill_price": float(order.average_fill_price) if order.average_fill_price else None,
            "commission": float(order.commission),
        },
        "signal": {
            "direction": signal.direction.value,
            "confidence": signal.confidence_score,
            "stop_loss": float(signal.stop_loss_price),
            "take_profit": float(signal.take_profit_price),
        },
        "assessment": {
            "position_size_usd": float(assessment.position_size_usd),
            "max_loss_usd": float(assessment.max_loss_usd),
            "risk_reward": float(assessment.risk_reward_ratio),
        },
        "portfolio": engine.portfolio.to_summary(),
    }


@router.get("/positions", summary="List open paper trading positions")
async def get_positions() -> dict[str, Any]:
    """Return all open paper trading positions."""
    engine = _get_engine()
    positions = engine.portfolio.open_positions
    return {
        "count": len(positions),
        "positions": [
            {
                "id": p.id,
                "symbol": p.symbol,
                "side": p.side.value,
                "quantity": float(p.quantity),
                "entry_price": float(p.entry_price),
                "current_price": float(p.current_price),
                "unrealized_pnl": float(p.unrealized_pnl),
                "unrealized_pnl_pct": float(p.unrealized_pnl_pct),
                "stop_loss": float(p.stop_loss_price) if p.stop_loss_price else None,
                "take_profit": float(p.take_profit_price) if p.take_profit_price else None,
                "opened_at": p.opened_at.isoformat(),
            }
            for p in positions
        ],
    }


@router.delete("/positions/{position_id}", summary="Close a paper trading position")
async def close_position(position_id: str) -> dict[str, Any]:
    """Manually close an open paper trading position.

    Args:
        position_id: UUID of the position to close.

    Returns:
        Close result and updated portfolio summary.
    """
    engine = _get_engine()

    # Find position and get current price
    position = next(
        (p for p in engine.portfolio.open_positions if p.id == position_id), None
    )
    if position is None:
        raise HTTPException(status_code=404, detail=f"Position {position_id} not found")

    collector = MarketDataCollector(okx_client=OKXRestClient(), cache=CacheClient())
    try:
        ticker = await collector.fetch_ticker(position.symbol)
        current_price = ticker.last
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch price: {exc}") from exc

    closed = engine.close_position(position_id, current_price)
    if not closed:
        raise HTTPException(status_code=500, detail="Failed to close position")

    return {
        "closed": True,
        "position_id": position_id,
        "exit_price": float(current_price),
        "portfolio": engine.portfolio.to_summary(),
    }
