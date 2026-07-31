"""Core domain entities for news, sentiment, and on-chain data."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from src.core.domain.value_objects.enums import NewsImpact, SentimentLabel


@dataclass(frozen=True)
class NewsArticle:
    """A cryptocurrency news article.

    Attributes:
        id: Unique article identifier.
        title: Article headline.
        url: Article URL.
        source: News source name.
        published_at: Publication timestamp (UTC).
        symbols: Cryptocurrency symbols mentioned.
        sentiment: Inferred sentiment label.
        impact: Estimated market impact.
        summary: Brief article summary (optional).
        body: Full article body text (optional).
        created_at: Ingestion timestamp.
    """

    title: str
    url: str
    source: str
    published_at: datetime
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    symbols: list[str] = field(default_factory=list)
    sentiment: SentimentLabel = SentimentLabel.NEUTRAL
    impact: NewsImpact = NewsImpact.LOW
    summary: str = ""
    body: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass(frozen=True)
class SentimentData:
    """Market sentiment data point.

    Aggregates sentiment signals from various sources
    (news, social media, Fear & Greed index, etc.).

    Attributes:
        id: Unique identifier.
        symbol: Cryptocurrency symbol (or 'MARKET' for global).
        score: Numeric sentiment score -1.0 (bearish) to +1.0 (bullish).
        label: Categorical sentiment label.
        source: Data source identifier.
        fear_greed_index: CNN Fear & Greed Index value (0–100).
        social_volume: Normalized social media mention volume.
        bullish_mentions: Count of bullish social mentions.
        bearish_mentions: Count of bearish social mentions.
        timestamp: Data point timestamp (UTC).
    """

    symbol: str
    score: float
    label: SentimentLabel
    source: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    fear_greed_index: int | None = None
    social_volume: float = 0.0
    bullish_mentions: int = 0
    bearish_mentions: int = 0
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def __post_init__(self) -> None:
        """Validate sentiment invariants."""
        if not (-1.0 <= self.score <= 1.0):
            raise ValueError("Sentiment score must be between -1.0 and 1.0")
        if self.fear_greed_index is not None and not (0 <= self.fear_greed_index <= 100):
            raise ValueError("Fear & Greed index must be between 0 and 100")


@dataclass(frozen=True)
class OnChainMetric:
    """A single on-chain data point.

    Represents a blockchain analytics metric such as active addresses,
    exchange netflow, NVT ratio, MVRV, etc.

    Attributes:
        id: Unique identifier.
        symbol: Cryptocurrency symbol (e.g. 'BTC', 'ETH').
        metric_name: Metric identifier (e.g. 'active_addresses').
        value: Metric numeric value.
        unit: Unit of measurement (e.g. 'USD', 'BTC', 'count').
        source: Data provider name.
        description: Human-readable metric description.
        timestamp: Metric timestamp (UTC).
    """

    symbol: str
    metric_name: str
    value: float
    unit: str
    source: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    description: str = ""
    timestamp: datetime = field(default_factory=datetime.utcnow)
