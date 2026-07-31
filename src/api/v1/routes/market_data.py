"""Market data API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.core.domain.value_objects.enums import Timeframe
from src.core.logging import get_logger
from src.features.market_data.collectors.market_data_collector import MarketDataCollector
from src.infrastructure.cache.redis_client import CacheClient
from src.infrastructure.external_apis.okx.rest_client import OKXClientError, OKXRestClient

router = APIRouter()
logger = get_logger(__name__)


def _get_collector() -> MarketDataCollector:
    """Dependency factory for MarketDataCollector."""
    return MarketDataCollector(
        okx_client=OKXRestClient(),
        cache=CacheClient(),
    )


@router.get("/candles/{symbol}", summary="Fetch OHLCV candlestick data")
async def get_candles(
    symbol: str,
    timeframe: Timeframe = Query(default=Timeframe.H1, description="Candlestick interval"),
    limit: int = Query(default=100, ge=1, le=300, description="Number of candles"),
) -> dict[str, Any]:
    """Fetch OHLCV candlestick data for a trading pair.

    Args:
        symbol: Instrument ID (e.g. BTC-USDT-SWAP).
        timeframe: Candlestick interval.
        limit: Number of bars (max 300).

    Returns:
        Dict with symbol, timeframe, and list of OHLCV bars.
    """
    collector = _get_collector()
    try:
        bars = await collector.fetch_ohlcv(symbol, timeframe, limit=limit)
    except OKXClientError as exc:
        raise HTTPException(status_code=502, detail=f"OKX API error: {exc}") from exc
    except Exception as exc:
        logger.error("Failed to fetch candles", symbol=symbol, error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to fetch market data") from exc

    return {
        "symbol": symbol,
        "timeframe": timeframe.value,
        "count": len(bars),
        "bars": [
            {
                "timestamp": b.timestamp.isoformat(),
                "open": float(b.open),
                "high": float(b.high),
                "low": float(b.low),
                "close": float(b.close),
                "volume": float(b.volume),
            }
            for b in bars
        ],
    }


@router.get("/ticker/{symbol}", summary="Fetch latest ticker")
async def get_ticker(symbol: str) -> dict[str, Any]:
    """Fetch the latest ticker data for a trading pair.

    Args:
        symbol: Instrument ID (e.g. BTC-USDT-SWAP).

    Returns:
        Current ticker with price, volume, and funding rate.
    """
    collector = _get_collector()
    try:
        ticker = await collector.fetch_ticker(symbol)
    except OKXClientError as exc:
        raise HTTPException(status_code=502, detail=f"OKX API error: {exc}") from exc
    except Exception as exc:
        logger.error("Failed to fetch ticker", symbol=symbol, error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to fetch ticker") from exc

    return {
        "symbol": ticker.symbol,
        "timestamp": ticker.timestamp.isoformat(),
        "last": float(ticker.last),
        "bid": float(ticker.bid),
        "ask": float(ticker.ask),
        "volume_24h": float(ticker.volume_24h),
        "price_change_24h": float(ticker.price_change_24h),
        "funding_rate": float(ticker.funding_rate) if ticker.funding_rate else None,
        "open_interest": float(ticker.open_interest) if ticker.open_interest else None,
    }
