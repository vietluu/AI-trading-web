"""AI market analysis using OpenAI GPT models.

Generates structured trading analysis by combining:
- Technical indicator values
- News sentiment summaries
- On-chain metric data
- Current market context
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion

from src.core.config import get_settings
from src.core.domain.entities.research import NewsArticle, OnChainMetric, SentimentData
from src.core.domain.value_objects.enums import SignalDirection, SignalStrength
from src.core.logging import get_logger
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalIndicators

logger = get_logger(__name__)

_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "direction": {
            "type": "string",
            "enum": ["long", "short", "neutral"],
            "description": "Recommended trade direction",
        },
        "strength": {
            "type": "string",
            "enum": ["strong", "moderate", "weak"],
            "description": "Signal confidence level",
        },
        "confidence_score": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
            "description": "Numeric confidence 0.0 to 1.0",
        },
        "reasoning": {
            "type": "string",
            "description": "Detailed reasoning for the recommendation",
        },
        "key_risks": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Top 3 risks to monitor",
        },
        "entry_zone_pct": {
            "type": "number",
            "description": "Suggested entry relative to current price in percentage",
        },
        "stop_loss_pct": {
            "type": "number",
            "minimum": 0.1,
            "maximum": 20.0,
            "description": "Stop loss percentage from entry",
        },
        "take_profit_pct": {
            "type": "number",
            "minimum": 0.1,
            "maximum": 50.0,
            "description": "Take profit percentage from entry",
        },
        "market_regime": {
            "type": "string",
            "enum": ["trending_up", "trending_down", "ranging", "volatile"],
            "description": "Current market regime",
        },
    },
    "required": [
        "direction",
        "strength",
        "confidence_score",
        "reasoning",
        "key_risks",
        "stop_loss_pct",
        "take_profit_pct",
        "market_regime",
    ],
}

_SYSTEM_PROMPT = """You are an expert cryptocurrency futures trading analyst with 15+ years of experience.
You analyze market data including technical indicators, news sentiment, and on-chain metrics
to produce actionable, risk-managed trading signals.

Always respond with well-reasoned, conservative analysis. Never recommend high-risk speculative
positions without strong confluence of signals. Risk management is paramount.

You must respond ONLY with valid JSON matching the provided schema. No markdown, no explanations
outside the JSON structure."""


@dataclass
class AIAnalysisResult:
    """Result of an AI market analysis session.

    Attributes:
        id: Unique analysis identifier.
        symbol: Analyzed trading pair.
        direction: Recommended trade direction.
        strength: Signal strength.
        confidence_score: Numeric confidence 0.0–1.0.
        reasoning: Detailed textual reasoning.
        key_risks: Top risk factors to monitor.
        stop_loss_pct: Recommended stop loss percentage.
        take_profit_pct: Recommended take profit percentage.
        market_regime: Identified market regime.
        raw_response: Full raw JSON response from OpenAI.
        created_at: Analysis timestamp.
        model_used: OpenAI model identifier.
        tokens_used: Total tokens consumed.
    """

    id: str
    symbol: str
    direction: SignalDirection
    strength: SignalStrength
    confidence_score: float
    reasoning: str
    key_risks: list[str]
    stop_loss_pct: float
    take_profit_pct: float
    market_regime: str
    raw_response: dict[str, Any]
    created_at: datetime
    model_used: str
    tokens_used: int


class AIMarketAnalyzer:
    """Analyzes market conditions using OpenAI GPT models.

    Combines technical, fundamental, and on-chain data into
    a structured analysis prompt and parses the JSON response.

    Args:
        client: AsyncOpenAI client instance (created from config if None).
    """

    def __init__(self, client: AsyncOpenAI | None = None) -> None:
        settings = get_settings()
        self._client = client or AsyncOpenAI(api_key=settings.openai.api_key)
        self._model = settings.openai.model
        self._max_tokens = settings.openai.max_tokens
        self._temperature = settings.openai.temperature

    async def analyze(
        self,
        symbol: str,
        current_price: float,
        technical: TechnicalIndicators,
        news: list[NewsArticle] | None = None,
        sentiment: list[SentimentData] | None = None,
        onchain: list[OnChainMetric] | None = None,
        timeframe: str = "4h",
    ) -> AIAnalysisResult:
        """Run an AI analysis for the given market context.

        Args:
            symbol: Trading pair symbol.
            current_price: Current market price.
            technical: Computed technical indicators.
            news: Recent news articles.
            sentiment: Recent sentiment data points.
            onchain: Recent on-chain metric data.
            timeframe: Analysis timeframe (informational).

        Returns:
            Structured AIAnalysisResult.

        Raises:
            ValueError: On invalid/unparseable AI response.
            openai.APIError: On OpenAI API failures.
        """
        prompt = self._build_prompt(
            symbol=symbol,
            current_price=current_price,
            technical=technical,
            news=news or [],
            sentiment=sentiment or [],
            onchain=onchain or [],
            timeframe=timeframe,
        )

        logger.info("Running AI analysis", symbol=symbol, model=self._model)

        response: ChatCompletion = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            response_format={"type": "json_object"},
        )

        raw_content = response.choices[0].message.content or "{}"
        tokens_used = response.usage.total_tokens if response.usage else 0

        try:
            parsed: dict[str, Any] = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse AI response JSON", error=str(exc))
            raise ValueError(f"AI returned invalid JSON: {exc}") from exc

        return self._build_result(
            analysis_id=response.id,
            symbol=symbol,
            parsed=parsed,
            raw=parsed,
            model=response.model,
            tokens=tokens_used,
        )

    def _build_prompt(
        self,
        symbol: str,
        current_price: float,
        technical: TechnicalIndicators,
        news: list[NewsArticle],
        sentiment: list[SentimentData],
        onchain: list[OnChainMetric],
        timeframe: str,
    ) -> str:
        """Build the analysis prompt from all available data."""
        sections = [
            "## Market Analysis Request",
            f"**Symbol**: {symbol}",
            f"**Timeframe**: {timeframe}",
            f"**Current Price**: ${current_price:,.2f}",
            f"**Analysis Time**: {datetime.utcnow().isoformat()}",
            "",
            "## Technical Indicators",
        ]

        indicators = technical.to_dict()
        for name, value in sorted(indicators.items()):
            sections.append(f"- {name}: {value:.4f}")

        if news:
            sections += ["", "## Recent News (last 24h)", ""]
            for article in news[:10]:
                sections.append(
                    f"- [{article.sentiment.value.upper()}] {article.title} "
                    f"(Source: {article.source}, Impact: {article.impact.value})"
                )

        if sentiment:
            sections += ["", "## Sentiment Summary"]
            latest = sentiment[0]
            sections.append(f"- Overall sentiment: {latest.label.value} (score: {latest.score:.2f})")
            if latest.fear_greed_index is not None:
                sections.append(f"- Fear & Greed Index: {latest.fear_greed_index}/100")
            if latest.bullish_mentions + latest.bearish_mentions > 0:
                total = latest.bullish_mentions + latest.bearish_mentions
                bull_pct = latest.bullish_mentions / total * 100
                sections.append(
                    f"- Social mentions: {bull_pct:.1f}% bullish / "
                    f"{100 - bull_pct:.1f}% bearish"
                )

        if onchain:
            sections += ["", "## On-Chain Metrics"]
            for metric in onchain[:10]:
                sections.append(
                    f"- {metric.metric_name}: {metric.value:.4f} {metric.unit}"
                )

        sections += [
            "",
            "## Task",
            "Based on the above data, provide a comprehensive trading analysis.",
            "Consider all signals holistically. Be conservative with high leverage recommendations.",
            "Respond with valid JSON matching the analysis schema.",
        ]

        return "\n".join(sections)

    @staticmethod
    def _build_result(
        analysis_id: str,
        symbol: str,
        parsed: dict[str, Any],
        raw: dict[str, Any],
        model: str,
        tokens: int,
    ) -> AIAnalysisResult:
        """Build an AIAnalysisResult from a parsed JSON response."""
        direction_map = {
            "long": SignalDirection.LONG,
            "short": SignalDirection.SHORT,
            "neutral": SignalDirection.NEUTRAL,
        }
        strength_map = {
            "strong": SignalStrength.STRONG,
            "moderate": SignalStrength.MODERATE,
            "weak": SignalStrength.WEAK,
        }

        return AIAnalysisResult(
            id=analysis_id,
            symbol=symbol,
            direction=direction_map.get(parsed.get("direction", "neutral"), SignalDirection.NEUTRAL),
            strength=strength_map.get(parsed.get("strength", "weak"), SignalStrength.WEAK),
            confidence_score=float(parsed.get("confidence_score", 0.5)),
            reasoning=parsed.get("reasoning", ""),
            key_risks=parsed.get("key_risks", []),
            stop_loss_pct=float(parsed.get("stop_loss_pct", 2.0)),
            take_profit_pct=float(parsed.get("take_profit_pct", 4.0)),
            market_regime=parsed.get("market_regime", "ranging"),
            raw_response=raw,
            created_at=datetime.utcnow(),
            model_used=model,
            tokens_used=tokens,
        )
