"""Backtesting API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.core.domain.value_objects.enums import Timeframe
from src.core.logging import get_logger
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer
from src.features.backtesting.engine.backtesting_engine import BacktestingEngine
from src.features.market_data.collectors.market_data_collector import MarketDataCollector
from src.infrastructure.cache.redis_client import CacheClient
from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

router = APIRouter()
logger = get_logger(__name__)


class BacktestRequest(BaseModel):
    """Request body for running a backtest."""

    symbol: str = Field(description="Trading pair symbol (e.g. BTC-USDT-SWAP)")
    timeframe: Timeframe = Field(default=Timeframe.H4, description="Candlestick interval")
    bars: int = Field(
        default=300,
        ge=100,
        le=500,
        description="Number of historical bars to use",
    )
    initial_capital: float = Field(default=10_000.0, ge=100.0)
    risk_pct: float = Field(default=0.02, ge=0.001, le=0.1)
    stop_loss_pct: float = Field(default=0.02, ge=0.001, le=0.2)
    take_profit_pct: float = Field(default=0.04, ge=0.001, le=0.5)
    leverage: int = Field(default=1, ge=1, le=10)


@router.post("/run", summary="Run a backtest")
async def run_backtest(request: BacktestRequest) -> dict[str, Any]:
    """Run a historical backtest using the RSI + MACD strategy.

    Fetches historical OHLCV data from OKX, runs the backtesting
    engine, and returns comprehensive performance metrics.

    Args:
        request: Backtest configuration parameters.

    Returns:
        Backtest summary with returns, Sharpe ratio, drawdown, win rate, etc.
    """
    collector = MarketDataCollector(okx_client=OKXRestClient(), cache=CacheClient())
    technical = TechnicalAnalyzer()

    logger.info(
        "Starting backtest",
        symbol=request.symbol,
        timeframe=request.timeframe.value,
        bars=request.bars,
    )

    try:
        bars = await collector.fetch_ohlcv(
            request.symbol,
            request.timeframe,
            limit=request.bars,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch market data: {exc}") from exc

    if len(bars) < 100:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient data: only {len(bars)} bars available (need 100+)",
        )

    engine = BacktestingEngine(
        technical_analyzer=technical,
        initial_capital=request.initial_capital,
        risk_pct=request.risk_pct,
        stop_loss_pct=request.stop_loss_pct,
        take_profit_pct=request.take_profit_pct,
        leverage=request.leverage,
    )

    try:
        result = engine.run(
            bars=bars,
            strategy_name="technical_rsi_macd",
            parameters={
                "stop_loss_pct": request.stop_loss_pct,
                "take_profit_pct": request.take_profit_pct,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Backtest failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}") from exc

    summary = result.to_summary()
    # Attach equity curve for charting
    summary["equity_curve"] = result.equity_curve[-100:]  # last 100 points for response size

    logger.info(
        "Backtest completed",
        symbol=request.symbol,
        total_trades=result.total_trades,
        total_return_pct=summary["total_return_pct"],
        sharpe=summary["sharpe_ratio"],
    )
    return summary
