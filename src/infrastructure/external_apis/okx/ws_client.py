"""OKX WebSocket client for real-time market data streaming."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

from src.core.config import get_settings
from src.core.domain.entities.market_data import OHLCV, Ticker
from src.core.domain.value_objects.enums import Timeframe
from src.core.logging import get_logger

logger = get_logger(__name__)

_TF_MAP: dict[Timeframe, str] = {
    Timeframe.M1: "candle1m",
    Timeframe.M5: "candle5m",
    Timeframe.M15: "candle15m",
    Timeframe.M30: "candle30m",
    Timeframe.H1: "candle1H",
    Timeframe.H4: "candle4H",
    Timeframe.D1: "candle1D",
}

TickerCallback = Callable[[Ticker], None]
OHLCVCallback = Callable[[OHLCV], None]


class OKXWebSocketClient:
    """Async WebSocket client for OKX real-time data feeds.

    Supports public channels (tickers, candles, order book) and
    private channels (orders, positions, account) with automatic
    reconnection on disconnects.

    Args:
        on_ticker: Optional callback invoked on ticker updates.
        on_ohlcv: Optional callback invoked on candle updates.
    """

    def __init__(
        self,
        on_ticker: TickerCallback | None = None,
        on_ohlcv: OHLCVCallback | None = None,
    ) -> None:
        settings = get_settings()
        self._public_url = settings.okx.ws_public_url
        self._private_url = settings.okx.ws_private_url
        self._api_key = settings.okx.api_key
        self._api_secret = settings.okx.api_secret
        self._passphrase = settings.okx.passphrase
        self._sandbox = settings.okx.sandbox
        self._on_ticker = on_ticker
        self._on_ohlcv = on_ohlcv
        self._running = False
        self._subscriptions: list[dict[str, str]] = []

    def _build_login_msg(self) -> dict[str, Any]:
        """Build the WebSocket login message for private channels."""
        ts = str(int(time.time()))
        sign_str = f"{ts}GET/users/self/verify"
        signature = base64.b64encode(
            hmac.new(
                self._api_secret.encode(),
                sign_str.encode(),
                hashlib.sha256,
            ).digest()
        ).decode()
        return {
            "op": "login",
            "args": [
                {
                    "apiKey": self._api_key,
                    "passphrase": self._passphrase,
                    "timestamp": ts,
                    "sign": signature,
                }
            ],
        }

    async def subscribe_tickers(
        self,
        symbols: list[str],
        callback: TickerCallback | None = None,
    ) -> None:
        """Subscribe to real-time ticker updates for given symbols.

        Args:
            symbols: List of instrument IDs (e.g. ['BTC-USDT-SWAP']).
            callback: Override default ticker callback.
        """
        cb = callback or self._on_ticker
        channels = [{"channel": "tickers", "instId": s} for s in symbols]
        await self._run_public(channels, lambda msg: self._handle_ticker(msg, cb))

    async def subscribe_candles(
        self,
        symbol: str,
        timeframe: Timeframe,
        callback: OHLCVCallback | None = None,
    ) -> None:
        """Subscribe to real-time candlestick updates.

        Args:
            symbol: Instrument ID.
            timeframe: Candle interval.
            callback: Override default OHLCV callback.
        """
        cb = callback or self._on_ohlcv
        channel = _TF_MAP.get(timeframe, "candle1H")
        channels = [{"channel": channel, "instId": symbol}]
        await self._run_public(channels, lambda msg: self._handle_candle(msg, symbol, timeframe, cb))

    async def _run_public(
        self,
        channels: list[dict[str, str]],
        handler: Callable[[dict[str, Any]], None],
    ) -> None:
        """Internal: connect and stream from the public WebSocket endpoint."""
        self._running = True
        while self._running:
            try:
                async with websockets.connect(
                    self._public_url,
                    ping_interval=20,
                    ping_timeout=10,
                ) as ws:
                    sub_msg = {"op": "subscribe", "args": channels}
                    await ws.send(json.dumps(sub_msg))
                    logger.info("WS subscribed", channels=channels)

                    async for raw in ws:
                        msg: dict[str, Any] = json.loads(raw)
                        if msg.get("event") in ("subscribe", "login"):
                            continue
                        if "data" in msg:
                            handler(msg)
            except ConnectionClosed as exc:
                logger.warning("WS connection closed, reconnecting", reason=str(exc))
                await asyncio.sleep(5)
            except Exception as exc:
                logger.error("WS error, reconnecting", error=str(exc))
                await asyncio.sleep(10)

    def stop(self) -> None:
        """Signal the WebSocket loop to stop on the next iteration."""
        self._running = False

    @staticmethod
    def _handle_ticker(
        msg: dict[str, Any],
        callback: TickerCallback | None,
    ) -> None:
        """Parse and dispatch a ticker WebSocket message."""
        if callback is None:
            return
        for row in msg.get("data", []):
            try:
                ts = datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC)
                ticker = Ticker(
                    symbol=row["instId"],
                    timestamp=ts,
                    last=Decimal(row["last"]),
                    bid=Decimal(row["bidPx"]),
                    ask=Decimal(row["askPx"]),
                    volume_24h=Decimal(row["vol24h"]),
                )
                callback(ticker)
            except Exception as exc:
                logger.warning("Failed to parse ticker", error=str(exc), row=row)

    @staticmethod
    def _handle_candle(
        msg: dict[str, Any],
        symbol: str,
        timeframe: Timeframe,
        callback: OHLCVCallback | None,
    ) -> None:
        """Parse and dispatch a candle WebSocket message."""
        if callback is None:
            return
        for row in msg.get("data", []):
            try:
                ts = datetime.fromtimestamp(int(row[0]) / 1000, tz=UTC)
                bar = OHLCV(
                    symbol=symbol,
                    timeframe=timeframe,
                    timestamp=ts,
                    open=Decimal(row[1]),
                    high=Decimal(row[2]),
                    low=Decimal(row[3]),
                    close=Decimal(row[4]),
                    volume=Decimal(row[5]),
                    quote_volume=Decimal(row[6]) if len(row) > 6 else Decimal("0"),
                )
                callback(bar)
            except Exception as exc:
                logger.warning("Failed to parse candle", error=str(exc), row=row)
