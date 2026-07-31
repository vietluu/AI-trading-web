"""Glassnode on-chain metrics API client.

Integrates the Glassnode v1 API for blockchain analytics data.
Documentation: https://docs.glassnode.com/api/metrics
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from src.core.config import get_settings
from src.core.domain.entities.research import OnChainMetric
from src.core.logging import get_logger

logger = get_logger(__name__)

# Well-known Glassnode metric paths
METRIC_PATHS: dict[str, dict[str, str]] = {
    "active_addresses": {
        "path": "/v1/metrics/addresses/active_count",
        "description": "Number of unique addresses active as sender or receiver",
        "unit": "count",
    },
    "exchange_netflow": {
        "path": "/v1/metrics/transactions/transfers_volume_exchanges_net",
        "description": "Net flow of coins into/out of exchange addresses",
        "unit": "BTC",
    },
    "nvt_ratio": {
        "path": "/v1/metrics/indicators/nvt",
        "description": "Network Value to Transactions Ratio",
        "unit": "ratio",
    },
    "mvrv_ratio": {
        "path": "/v1/metrics/market/mvrv",
        "description": "Market Value to Realized Value Ratio",
        "unit": "ratio",
    },
    "sopr": {
        "path": "/v1/metrics/indicators/sopr",
        "description": "Spent Output Profit Ratio",
        "unit": "ratio",
    },
    "hash_rate": {
        "path": "/v1/metrics/mining/hash_rate_mean",
        "description": "Mean hash rate of the Bitcoin network",
        "unit": "TH/s",
    },
    "supply_exchanges": {
        "path": "/v1/metrics/distribution/supply_exchanges",
        "description": "Percentage of supply held on exchanges",
        "unit": "BTC",
    },
}


class GlassnodeClient:
    """HTTP client for the Glassnode on-chain metrics API.

    Args:
        api_key: Glassnode API key (defaults to config).
    """

    def __init__(self, api_key: str = "") -> None:
        settings = get_settings()
        self._api_key = api_key or settings.glassnode.api_key
        self._base_url = settings.glassnode.base_url
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=15),
        reraise=True,
    )
    async def get_metric(
        self,
        metric_name: str,
        symbol: str = "BTC",
        interval: str = "24h",
        limit: int = 30,
    ) -> list[OnChainMetric]:
        """Fetch an on-chain metric time series from Glassnode.

        Args:
            metric_name: Metric identifier (key in METRIC_PATHS).
            symbol: Cryptocurrency symbol (e.g. 'BTC', 'ETH').
            interval: Data resolution: '1h', '24h', '10m'.
            limit: Number of data points to return.

        Returns:
            List of OnChainMetric entities ordered by timestamp.

        Raises:
            KeyError: If metric_name is not registered in METRIC_PATHS.
            httpx.HTTPError: On transport failures.
        """
        if metric_name not in METRIC_PATHS:
            raise KeyError(
                f"Unknown metric: {metric_name}. "
                f"Available: {list(METRIC_PATHS.keys())}"
            )

        meta = METRIC_PATHS[metric_name]
        client = await self._get_client()

        params = {
            "a": symbol.upper(),
            "i": interval,
            "api_key": self._api_key,
            "limit": str(limit),
            "format": "JSON",
        }

        url = f"{self._base_url}{meta['path']}"
        response = await client.get(url, params=params)
        response.raise_for_status()

        raw_data: list[dict[str, Any]] = response.json()
        metrics: list[OnChainMetric] = []

        for point in raw_data:
            try:
                ts = datetime.fromtimestamp(point["t"], tz=UTC)
                value = float(point["v"]) if point.get("v") is not None else 0.0
                metrics.append(
                    OnChainMetric(
                        symbol=symbol.upper(),
                        metric_name=metric_name,
                        value=value,
                        unit=meta["unit"],
                        source="glassnode",
                        description=meta["description"],
                        timestamp=ts,
                    )
                )
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning("Failed to parse on-chain data point", error=str(exc))

        logger.info(
            "Fetched on-chain metric",
            metric=metric_name,
            symbol=symbol,
            count=len(metrics),
        )
        return metrics

    async def get_multiple_metrics(
        self,
        metric_names: list[str],
        symbol: str = "BTC",
    ) -> dict[str, list[OnChainMetric]]:
        """Fetch multiple on-chain metrics concurrently.

        Args:
            metric_names: List of metric identifiers.
            symbol: Cryptocurrency symbol.

        Returns:
            Dict mapping metric name to list of OnChainMetric.
        """

        tasks = {name: self.get_metric(name, symbol=symbol) for name in metric_names}
        results: dict[str, list[OnChainMetric]] = {}

        for name, coro in tasks.items():
            try:
                results[name] = await coro
            except Exception as exc:
                logger.error("Failed to fetch on-chain metric", metric=name, error=str(exc))
                results[name] = []

        return results
