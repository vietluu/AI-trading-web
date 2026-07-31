"""CryptoPanic News API client.

Integrates the CryptoPanic v1 API for cryptocurrency news aggregation.
Documentation: https://cryptopanic.com/developers/api/
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from src.core.config import get_settings
from src.core.domain.entities.research import NewsArticle
from src.core.domain.value_objects.enums import NewsImpact, SentimentLabel
from src.core.logging import get_logger

logger = get_logger(__name__)

_SENTIMENT_MAP: dict[str, SentimentLabel] = {
    "positive": SentimentLabel.BULLISH,
    "negative": SentimentLabel.BEARISH,
    "neutral": SentimentLabel.NEUTRAL,
}


class CryptoPanicClient:
    """HTTP client for the CryptoPanic news API.

    Fetches aggregated cryptocurrency news with sentiment and
    market-impact metadata.

    Args:
        api_key: CryptoPanic API key (defaults to config).
    """

    def __init__(self, api_key: str = "") -> None:
        settings = get_settings()
        self._api_key = api_key or settings.cryptopanic.api_key
        self._base_url = settings.cryptopanic.base_url
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0))
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
    async def get_posts(
        self,
        currencies: list[str] | None = None,
        kind: str = "news",
        filter_: str = "hot",
        limit: int = 50,
        public: bool = True,
    ) -> list[NewsArticle]:
        """Fetch recent news posts from CryptoPanic.

        Args:
            currencies: Filter by currency symbols (e.g. ['BTC', 'ETH']).
            kind: Post type: 'news', 'media', 'article'.
            filter_: Sort filter: 'rising', 'hot', 'bullish', 'bearish', 'important', 'saved', 'lol'.
            limit: Maximum number of articles to return (max 50).
            public: Use public (unauthenticated) endpoint if True.

        Returns:
            List of NewsArticle domain entities.
        """
        client = await self._get_client()
        params: dict[str, Any] = {
            "auth_token": self._api_key,
            "kind": kind,
            "filter": filter_,
            "public": "true" if public else "false",
        }
        if currencies:
            params["currencies"] = ",".join(c.upper() for c in currencies)

        url = f"{self._base_url}/posts/"
        response = await client.get(url, params=params)
        response.raise_for_status()

        data = response.json()
        articles: list[NewsArticle] = []
        results = data.get("results", [])[:limit]

        for item in results:
            try:
                article = self._parse_article(item)
                articles.append(article)
            except Exception as exc:
                logger.warning("Failed to parse news article", error=str(exc))
                continue

        logger.info("Fetched news articles", count=len(articles), filter=filter_)
        return articles

    def _parse_article(self, item: dict[str, Any]) -> NewsArticle:
        """Parse a single CryptoPanic result into a NewsArticle."""
        currencies = item.get("currencies", []) or []
        symbols = [c["code"] for c in currencies if "code" in c]

        votes = item.get("votes", {}) or {}
        bullish = votes.get("positive", 0) or 0
        bearish = votes.get("negative", 0) or 0

        if bullish > bearish * 2:
            sentiment = SentimentLabel.BULLISH
        elif bearish > bullish * 2:
            sentiment = SentimentLabel.BEARISH
        elif votes.get("important", 0):
            sentiment = SentimentLabel.NEUTRAL
        else:
            sentiment = SentimentLabel.NEUTRAL

        impact = NewsImpact.LOW
        if votes.get("important", 0) and votes.get("important", 0) > 5:
            impact = NewsImpact.HIGH
        elif bullish + bearish > 10:
            impact = NewsImpact.MEDIUM

        published_str = item.get("published_at", "")
        try:
            published_at = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            published_at = datetime.now(tz=UTC)

        source_info = item.get("source", {}) or {}

        return NewsArticle(
            title=item.get("title", ""),
            url=item.get("url", ""),
            source=source_info.get("domain", "cryptopanic"),
            published_at=published_at,
            symbols=symbols,
            sentiment=sentiment,
            impact=impact,
            summary=item.get("title", ""),
        )
