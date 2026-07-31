"""OKX Exchange REST API client.

Implements authenticated REST calls to OKX v5 API following their
official documentation: https://www.okx.com/docs-v5/en/
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from src.core.config import get_settings
from src.core.domain.entities.market_data import OHLCV, Ticker
from src.core.domain.entities.trading import Order
from src.core.domain.value_objects.enums import (
    OrderSide,
    OrderStatus,
    OrderType,
    Timeframe,
)
from src.core.logging import get_logger

logger = get_logger(__name__)

# Map internal timeframe to OKX bar parameter
_TF_MAP: dict[Timeframe, str] = {
    Timeframe.M1: "1m",
    Timeframe.M3: "3m",
    Timeframe.M5: "5m",
    Timeframe.M15: "15m",
    Timeframe.M30: "30m",
    Timeframe.H1: "1H",
    Timeframe.H2: "2H",
    Timeframe.H4: "4H",
    Timeframe.H6: "6H",
    Timeframe.H12: "12H",
    Timeframe.D1: "1D",
    Timeframe.W1: "1W",
}

_SIDE_MAP: dict[str, OrderSide] = {"buy": OrderSide.BUY, "sell": OrderSide.SELL}
_STATUS_MAP: dict[str, OrderStatus] = {
    "live": OrderStatus.OPEN,
    "partially_filled": OrderStatus.PARTIALLY_FILLED,
    "filled": OrderStatus.FILLED,
    "canceled": OrderStatus.CANCELLED,
}


class OKXClientError(Exception):
    """Raised when the OKX API returns an error response."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"OKX API error [{code}]: {message}")


class OKXRestClient:
    """Async HTTP client for the OKX v5 REST API.

    Handles authentication, request signing, rate limiting,
    and response parsing.

    Args:
        api_key: OKX API key (empty for public endpoints).
        api_secret: OKX API secret.
        passphrase: OKX API passphrase.
        sandbox: Use OKX sandbox environment.
    """

    def __init__(
        self,
        api_key: str = "",
        api_secret: str = "",
        passphrase: str = "",
        sandbox: bool = True,
    ) -> None:
        settings = get_settings()
        self._api_key = api_key or settings.okx.api_key
        self._api_secret = api_secret or settings.okx.api_secret
        self._passphrase = passphrase or settings.okx.passphrase
        self._sandbox = sandbox if sandbox is not None else settings.okx.sandbox
        self._base_url = settings.okx.base_url
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Return (or create) the shared HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=httpx.Timeout(30.0),
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _sign(self, timestamp: str, method: str, path: str, body: str = "") -> str:
        """Generate HMAC-SHA256 signature for authenticated requests.

        The prehash string is: timestamp + method + requestPath + body
        """
        prehash = f"{timestamp}{method.upper()}{path}{body}"
        signature = hmac.new(
            self._api_secret.encode("utf-8"),
            prehash.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return base64.b64encode(signature).decode()

    def _auth_headers(self, method: str, path: str, body: str = "") -> dict[str, str]:
        """Build authentication headers for a private API request."""
        timestamp = datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        return {
            "OK-ACCESS-KEY": self._api_key,
            "OK-ACCESS-SIGN": self._sign(timestamp, method, path, body),
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": self._passphrase,
            "x-simulated-trading": "1" if self._sandbox else "0",
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        authenticated: bool = False,
    ) -> Any:
        """Execute an HTTP request against the OKX API.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: API endpoint path starting with ``/``.
            params: Query string parameters.
            body: Request body (for POST/PUT).
            authenticated: Whether to include auth headers.

        Returns:
            Parsed JSON response data.

        Raises:
            OKXClientError: On API error responses.
            httpx.HTTPError: On transport-level failures.
        """
        client = await self._get_client()
        body_str = json.dumps(body) if body else ""
        headers: dict[str, str] = {}

        if authenticated:
            headers = self._auth_headers(method, path, body_str)

        logger.debug("OKX request", method=method, path=path)
        response = await client.request(
            method,
            path,
            params=params,
            content=body_str.encode() if body_str else None,
            headers=headers,
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()

        code = data.get("code", "0")
        if code != "0":
            raise OKXClientError(code=str(code), message=data.get("msg", "Unknown error"))

        return data.get("data", data)

    # ------------------------------------------------------------------ #
    # Public Market Data Endpoints                                         #
    # ------------------------------------------------------------------ #

    async def get_candles(
        self,
        symbol: str,
        timeframe: Timeframe,
        limit: int = 100,
        after: str | None = None,
        before: str | None = None,
    ) -> list[OHLCV]:
        """Fetch OHLCV candlestick data from OKX.

        Args:
            symbol: Instrument ID, e.g. ``BTC-USDT-SWAP``.
            timeframe: Candlestick interval.
            limit: Number of candles to return (max 300).
            after: Return candles before this timestamp (pagination).
            before: Return candles after this timestamp (pagination).

        Returns:
            List of OHLCV bars sorted oldest-first.
        """
        params: dict[str, Any] = {
            "instId": symbol,
            "bar": _TF_MAP[timeframe],
            "limit": str(min(limit, 300)),
        }
        if after:
            params["after"] = after
        if before:
            params["before"] = before

        raw = await self._request("GET", "/api/v5/market/candles", params=params)
        bars: list[OHLCV] = []

        for row in reversed(raw):  # OKX returns newest first; we reverse to oldest-first
            ts = datetime.fromtimestamp(int(row[0]) / 1000, tz=UTC)
            bars.append(
                OHLCV(
                    symbol=symbol,
                    timeframe=timeframe,
                    timestamp=ts,
                    open=Decimal(row[1]),
                    high=Decimal(row[2]),
                    low=Decimal(row[3]),
                    close=Decimal(row[4]),
                    volume=Decimal(row[5]),
                    quote_volume=Decimal(row[6]) if len(row) > 6 else Decimal("0"),
                    trades=int(row[7]) if len(row) > 7 else 0,
                )
            )

        logger.info(
            "Fetched candles",
            symbol=symbol,
            timeframe=timeframe.value,
            count=len(bars),
        )
        return bars

    async def get_ticker(self, symbol: str) -> Ticker:
        """Fetch the latest ticker for a symbol.

        Args:
            symbol: Instrument ID, e.g. ``BTC-USDT-SWAP``.

        Returns:
            Current Ticker object.
        """
        raw = await self._request("GET", "/api/v5/market/ticker", params={"instId": symbol})
        row = raw[0]
        ts = datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC)

        return Ticker(
            symbol=symbol,
            timestamp=ts,
            last=Decimal(row["last"]),
            bid=Decimal(row["bidPx"]),
            ask=Decimal(row["askPx"]),
            volume_24h=Decimal(row["vol24h"]),
            price_change_24h=Decimal(row["last"]) - Decimal(row.get("open24h", row["last"])),
            funding_rate=Decimal(row["fundingRate"]) if "fundingRate" in row else None,
            open_interest=Decimal(row["openInterest"]) if "openInterest" in row else None,
        )

    async def get_instruments(self, inst_type: str = "SWAP") -> list[dict[str, Any]]:
        """Fetch available trading instruments.

        Args:
            inst_type: Instrument type: SPOT, MARGIN, SWAP, FUTURES, OPTION.

        Returns:
            List of instrument metadata dicts.
        """
        raw = await self._request(
            "GET",
            "/api/v5/public/instruments",
            params={"instType": inst_type},
        )
        return list(raw)  # type: ignore[return-value]

    async def get_funding_rate(self, symbol: str) -> Decimal:
        """Fetch current funding rate for a perpetual swap.

        Args:
            symbol: Instrument ID, e.g. ``BTC-USDT-SWAP``.

        Returns:
            Current funding rate as Decimal.
        """
        raw = await self._request(
            "GET",
            "/api/v5/public/funding-rate",
            params={"instId": symbol},
        )
        return Decimal(raw[0]["fundingRate"])

    # ------------------------------------------------------------------ #
    # Private Trading Endpoints                                            #
    # ------------------------------------------------------------------ #

    async def place_order(self, order: Order) -> str:
        """Submit an order to OKX.

        Args:
            order: Order domain entity to submit.

        Returns:
            Exchange-assigned order ID.

        Raises:
            OKXClientError: On API rejection.
        """
        body: dict[str, Any] = {
            "instId": order.symbol,
            "tdMode": "cross",  # cross-margin for futures
            "side": order.side.value,
            "ordType": self._map_order_type(order.order_type),
            "sz": str(order.quantity),
            "lever": str(order.leverage),
        }
        if order.price is not None:
            body["px"] = str(order.price)
        if order.stop_price is not None:
            body["slTriggerPx"] = str(order.stop_price)
            body["slOrdPx"] = "-1"  # market execution on stop trigger

        raw = await self._request("POST", "/api/v5/trade/order", body=body, authenticated=True)
        exchange_order_id: str = raw[0]["ordId"]
        logger.info("Order placed", symbol=order.symbol, exchange_order_id=exchange_order_id)
        return exchange_order_id

    async def cancel_order(self, symbol: str, exchange_order_id: str) -> bool:
        """Cancel an open order.

        Args:
            symbol: Instrument ID.
            exchange_order_id: Exchange-assigned order ID.

        Returns:
            True if successfully cancelled.
        """
        body = {"instId": symbol, "ordId": exchange_order_id}
        await self._request("POST", "/api/v5/trade/cancel-order", body=body, authenticated=True)
        logger.info("Order cancelled", symbol=symbol, order_id=exchange_order_id)
        return True

    async def get_order(self, symbol: str, exchange_order_id: str) -> dict[str, Any]:
        """Fetch order details from OKX.

        Args:
            symbol: Instrument ID.
            exchange_order_id: Exchange-assigned order ID.

        Returns:
            Raw order data dict.
        """
        raw = await self._request(
            "GET",
            "/api/v5/trade/order",
            params={"instId": symbol, "ordId": exchange_order_id},
            authenticated=True,
        )
        return dict(raw[0])  # type: ignore[arg-type]

    async def get_positions(self, symbol: str | None = None) -> list[dict[str, Any]]:
        """Fetch open positions.

        Args:
            symbol: Optional filter by instrument ID.

        Returns:
            List of raw position dicts from OKX.
        """
        params: dict[str, str] = {"instType": "SWAP"}
        if symbol:
            params["instId"] = symbol

        raw = await self._request(
            "GET", "/api/v5/account/positions", params=params, authenticated=True
        )
        return list(raw)  # type: ignore[return-value]

    async def get_account_balance(self) -> dict[str, Any]:
        """Fetch account balance information.

        Returns:
            Raw balance data from OKX.
        """
        raw = await self._request("GET", "/api/v5/account/balance", authenticated=True)
        return dict(raw[0])  # type: ignore[arg-type]

    @staticmethod
    def _map_order_type(order_type: OrderType) -> str:
        """Map internal order type to OKX API string."""
        mapping = {
            OrderType.MARKET: "market",
            OrderType.LIMIT: "limit",
            OrderType.STOP_MARKET: "conditional",
            OrderType.STOP_LIMIT: "conditional",
            OrderType.TAKE_PROFIT_MARKET: "conditional",
        }
        return mapping.get(order_type, "market")
