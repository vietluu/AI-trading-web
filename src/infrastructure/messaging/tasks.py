"""Celery task definitions for background processing."""

from __future__ import annotations

import asyncio
from typing import Any

from src.core.logging import configure_logging, get_logger
from src.infrastructure.messaging.celery_app import celery_app

logger = get_logger(__name__)


def run_async(coro: Any) -> Any:
    """Run an async coroutine from a synchronous Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(name="src.infrastructure.messaging.tasks.collect_market_data", bind=True)
def collect_market_data(self: Any, symbols: list[str], timeframe: str = "1h") -> dict[str, Any]:
    """Collect and cache OHLCV data for given symbols.

    Args:
        symbols: List of instrument IDs to collect.
        timeframe: Candlestick timeframe string.

    Returns:
        Collection result summary.
    """
    configure_logging()

    async def _run() -> dict[str, Any]:
        from src.core.domain.value_objects.enums import Timeframe
        from src.features.market_data.collectors.market_data_collector import MarketDataCollector
        from src.infrastructure.cache.redis_client import CacheClient
        from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

        tf = Timeframe(timeframe)
        collector = MarketDataCollector(
            okx_client=OKXRestClient(),
            cache=CacheClient(),
        )
        results: dict[str, int] = {}
        for symbol in symbols:
            try:
                bars = await collector.fetch_ohlcv(symbol, tf, limit=100, use_cache=False)
                results[symbol] = len(bars)
            except Exception as exc:
                logger.error("Failed to collect market data", symbol=symbol, error=str(exc))
                results[symbol] = -1

        return {"collected": results}

    return run_async(_run())


@celery_app.task(name="src.infrastructure.messaging.tasks.collect_news", bind=True)
def collect_news(self: Any, currencies: list[str]) -> dict[str, Any]:
    """Fetch and cache the latest crypto news.

    Args:
        currencies: List of currency codes (e.g. ['BTC', 'ETH']).

    Returns:
        Collection result summary.
    """
    configure_logging()

    async def _run() -> dict[str, Any]:
        from src.infrastructure.external_apis.news.cryptopanic_client import CryptoPanicClient

        client = CryptoPanicClient()
        try:
            articles = await client.get_posts(currencies=currencies, limit=20)
            return {"articles_fetched": len(articles)}
        except Exception as exc:
            logger.error("Failed to collect news", error=str(exc))
            return {"articles_fetched": 0, "error": str(exc)}
        finally:
            await client.close()

    return run_async(_run())


@celery_app.task(name="src.infrastructure.messaging.tasks.generate_signals", bind=True)
def generate_signals(self: Any, symbols: list[str], timeframe: str = "4h") -> dict[str, Any]:
    """Generate technical trading signals for given symbols.

    Args:
        symbols: List of instrument IDs.
        timeframe: Analysis timeframe string.

    Returns:
        Signal generation result summary.
    """
    configure_logging()

    async def _run() -> dict[str, Any]:
        from src.core.domain.value_objects.enums import Timeframe
        from src.features.ai_analysis.analyzers.ai_market_analyzer import AIMarketAnalyzer
        from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer
        from src.features.market_data.collectors.market_data_collector import MarketDataCollector
        from src.features.signals.generators.signal_generator import SignalGenerator
        from src.infrastructure.cache.redis_client import CacheClient
        from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

        tf = Timeframe(timeframe)
        generator = SignalGenerator(
            market_collector=MarketDataCollector(
                okx_client=OKXRestClient(),
                cache=CacheClient(),
            ),
            technical_analyzer=TechnicalAnalyzer(),
            ai_analyzer=AIMarketAnalyzer(),
        )

        results: dict[str, Any] = {}
        for symbol in symbols:
            try:
                signal = await generator.generate_technical_only(symbol=symbol, timeframe=tf)
                if signal:
                    results[symbol] = {
                        "direction": signal.direction.value,
                        "confidence": signal.confidence_score,
                    }
                else:
                    results[symbol] = {"direction": "neutral"}
            except Exception as exc:
                logger.error("Failed to generate signal", symbol=symbol, error=str(exc))
                results[symbol] = {"error": str(exc)}

        return {"signals": results}

    return run_async(_run())


@celery_app.task(name="src.infrastructure.messaging.tasks.update_paper_positions", bind=True)
def update_paper_positions(self: Any) -> dict[str, Any]:
    """Update prices for all open paper trading positions.

    Checks stop-loss and take-profit levels and closes triggered positions.

    Returns:
        Update result summary.
    """
    configure_logging()

    async def _run() -> dict[str, Any]:
        from src.api.v1.routes.paper_trading import _get_engine
        from src.features.market_data.collectors.market_data_collector import MarketDataCollector
        from src.infrastructure.cache.redis_client import CacheClient
        from src.infrastructure.external_apis.okx.rest_client import OKXRestClient

        engine = _get_engine()
        open_positions = engine.portfolio.open_positions

        if not open_positions:
            return {"updated": 0}

        symbols = list({p.symbol for p in open_positions})
        collector = MarketDataCollector(okx_client=OKXRestClient(), cache=CacheClient())

        prices = {}
        for symbol in symbols:
            try:
                ticker = await collector.fetch_ticker(symbol)
                prices[symbol] = ticker.last
            except Exception as exc:
                logger.error("Failed to fetch price", symbol=symbol, error=str(exc))

        if prices:
            engine.update_prices(prices)

        return {"updated": len(prices), "open_positions": len(engine.portfolio.open_positions)}

    return run_async(_run())
