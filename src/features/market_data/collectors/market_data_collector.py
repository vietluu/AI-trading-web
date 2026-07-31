"""Market data collection service.

Orchestrates fetching OHLCV data from OKX and persisting it
to the database, with Redis caching for hot data.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd

from src.core.domain.entities.market_data import OHLCV, Ticker
from src.core.domain.value_objects.enums import Timeframe
from src.core.logging import get_logger
from src.infrastructure.cache.redis_client import CacheClient
from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

logger = get_logger(__name__)


class MarketDataCollector:
    """Collects and caches market data from OKX.

    Follows the Single Responsibility Principle — only responsible
    for data collection and caching, not persistence.

    Args:
        okx_client: OKX REST API client.
        cache: Redis cache client.
    """

    def __init__(
        self,
        okx_client: OKXRestClient,
        cache: CacheClient,
    ) -> None:
        self._okx = okx_client
        self._cache = cache

    async def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: Timeframe,
        limit: int = 200,
        use_cache: bool = True,
    ) -> list[OHLCV]:
        """Fetch OHLCV bars, using the cache when available.

        Args:
            symbol: Trading pair symbol (e.g. 'BTC-USDT-SWAP').
            timeframe: Candlestick interval.
            limit: Number of bars to fetch.
            use_cache: Whether to check the cache first.

        Returns:
            List of OHLCV bars, oldest first.
        """
        cache_key = ("ohlcv", symbol, timeframe.value, str(limit))

        if use_cache:
            cached = await self._cache.get(*cache_key)
            if cached:
                logger.debug("OHLCV cache hit", symbol=symbol, timeframe=timeframe.value)
                return self._deserialize_ohlcv(cached, symbol, timeframe)

        bars = await self._okx.get_candles(symbol, timeframe, limit=limit)

        if bars:
            await self._cache.set(*cache_key, value=self._serialize_ohlcv(bars), ttl=60)

        logger.info("Collected OHLCV data", symbol=symbol, timeframe=timeframe.value, count=len(bars))
        return bars

    async def fetch_ticker(
        self,
        symbol: str,
        use_cache: bool = True,
    ) -> Ticker:
        """Fetch the latest ticker, using cache when available.

        Args:
            symbol: Trading pair symbol.
            use_cache: Whether to check the cache first (5s TTL).

        Returns:
            Current Ticker object.
        """
        cache_key = ("ticker", symbol)

        if use_cache:
            cached = await self._cache.get(*cache_key)
            if cached:
                return self._deserialize_ticker(cached, symbol)

        ticker = await self._okx.get_ticker(symbol)
        await self._cache.set(*cache_key, value=self._serialize_ticker(ticker), ttl=5)
        return ticker

    async def fetch_multiple_symbols(
        self,
        symbols: list[str],
        timeframe: Timeframe,
        limit: int = 200,
    ) -> dict[str, list[OHLCV]]:
        """Fetch OHLCV data for multiple symbols concurrently.

        Args:
            symbols: List of trading pair symbols.
            timeframe: Candlestick interval.
            limit: Bars per symbol.

        Returns:
            Dict mapping symbol to list of OHLCV bars.
        """

        tasks = {s: self.fetch_ohlcv(s, timeframe, limit) for s in symbols}
        results: dict[str, list[OHLCV]] = {}

        for symbol, coro in tasks.items():
            try:
                results[symbol] = await coro
            except Exception as exc:
                logger.error("Failed to fetch OHLCV", symbol=symbol, error=str(exc))
                results[symbol] = []

        return results

    def to_dataframe(self, bars: list[OHLCV]) -> pd.DataFrame:
        """Convert OHLCV list to a pandas DataFrame.

        The DataFrame is indexed by timestamp and contains columns:
        open, high, low, close, volume, quote_volume, trades.

        Args:
            bars: List of OHLCV bars.

        Returns:
            pandas DataFrame with OHLCV data.
        """
        if not bars:
            return pd.DataFrame()

        data = [
            {
                "timestamp": b.timestamp,
                "open": float(b.open),
                "high": float(b.high),
                "low": float(b.low),
                "close": float(b.close),
                "volume": float(b.volume),
                "quote_volume": float(b.quote_volume),
                "trades": b.trades,
            }
            for b in bars
        ]
        df = pd.DataFrame(data)
        df.set_index("timestamp", inplace=True)
        df.sort_index(inplace=True)
        return df

    @staticmethod
    def _serialize_ohlcv(bars: list[OHLCV]) -> list[dict]:
        return [
            {
                "timestamp": b.timestamp.isoformat(),
                "open": str(b.open),
                "high": str(b.high),
                "low": str(b.low),
                "close": str(b.close),
                "volume": str(b.volume),
                "quote_volume": str(b.quote_volume),
                "trades": b.trades,
            }
            for b in bars
        ]

    @staticmethod
    def _deserialize_ohlcv(data: list[dict], symbol: str, timeframe: Timeframe) -> list[OHLCV]:
        from decimal import Decimal

        bars = []
        for row in data:
            ts = datetime.fromisoformat(row["timestamp"])
            bars.append(
                OHLCV(
                    symbol=symbol,
                    timeframe=timeframe,
                    timestamp=ts,
                    open=Decimal(row["open"]),
                    high=Decimal(row["high"]),
                    low=Decimal(row["low"]),
                    close=Decimal(row["close"]),
                    volume=Decimal(row["volume"]),
                    quote_volume=Decimal(row["quote_volume"]),
                    trades=row["trades"],
                )
            )
        return bars

    @staticmethod
    def _serialize_ticker(ticker: Ticker) -> dict:
        return {
            "timestamp": ticker.timestamp.isoformat(),
            "last": str(ticker.last),
            "bid": str(ticker.bid),
            "ask": str(ticker.ask),
            "volume_24h": str(ticker.volume_24h),
            "price_change_24h": str(ticker.price_change_24h),
            "funding_rate": str(ticker.funding_rate) if ticker.funding_rate else None,
            "open_interest": str(ticker.open_interest) if ticker.open_interest else None,
        }

    @staticmethod
    def _deserialize_ticker(data: dict, symbol: str) -> Ticker:
        from decimal import Decimal

        return Ticker(
            symbol=symbol,
            timestamp=datetime.fromisoformat(data["timestamp"]),
            last=Decimal(data["last"]),
            bid=Decimal(data["bid"]),
            ask=Decimal(data["ask"]),
            volume_24h=Decimal(data["volume_24h"]),
            price_change_24h=Decimal(data["price_change_24h"]),
            funding_rate=Decimal(data["funding_rate"]) if data.get("funding_rate") else None,
            open_interest=Decimal(data["open_interest"]) if data.get("open_interest") else None,
        )
