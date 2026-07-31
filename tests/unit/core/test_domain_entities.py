"""Unit tests for core domain entities."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from src.core.domain.entities.market_data import OHLCV, OrderBook
from src.core.domain.entities.research import SentimentData
from src.core.domain.entities.signal import TradingSignal
from src.core.domain.entities.trading import Order, Position
from src.core.domain.value_objects.enums import (
    OrderSide,
    OrderStatus,
    OrderType,
    PositionSide,
    SentimentLabel,
    SignalDirection,
    SignalStrength,
    Timeframe,
)


class TestOHLCV:
    """Tests for the OHLCV value object."""

    def _make_ohlcv(self, **kwargs) -> OHLCV:
        defaults = dict(
            symbol="BTC-USDT-SWAP",
            timeframe=Timeframe.H1,
            timestamp=datetime(2024, 1, 1, 12, 0),
            open=Decimal("50000"),
            high=Decimal("51000"),
            low=Decimal("49000"),
            close=Decimal("50500"),
            volume=Decimal("100"),
        )
        defaults.update(kwargs)
        return OHLCV(**defaults)

    def test_valid_ohlcv(self) -> None:
        bar = self._make_ohlcv()
        assert bar.symbol == "BTC-USDT-SWAP"
        assert bar.is_bullish is True
        assert bar.is_bearish is False

    def test_bearish_candle(self) -> None:
        bar = self._make_ohlcv(open=Decimal("51000"), close=Decimal("50000"))
        assert bar.is_bearish is True
        assert bar.is_bullish is False

    def test_high_must_be_max(self) -> None:
        with pytest.raises(ValueError, match="High must be the maximum"):
            self._make_ohlcv(high=Decimal("49000"), low=Decimal("48000"))

    def test_low_must_be_min(self) -> None:
        # low=51500 > close=50500, but high=51000 < low=51500 triggers "High >= Low" first.
        # Use a case where low > open and low > close but high still valid.
        with pytest.raises(ValueError):
            self._make_ohlcv(
                high=Decimal("52000"),
                low=Decimal("51500"),  # low > open(50000) and low > close(50500)
            )

    def test_negative_volume(self) -> None:
        with pytest.raises(ValueError, match="Volume cannot be negative"):
            self._make_ohlcv(volume=Decimal("-1"))

    def test_body_size(self) -> None:
        bar = self._make_ohlcv(open=Decimal("50000"), close=Decimal("50500"))
        assert bar.body_size == Decimal("500")

    def test_range(self) -> None:
        bar = self._make_ohlcv()
        assert bar.range == Decimal("2000")

    def test_typical_price(self) -> None:
        bar = self._make_ohlcv(high=Decimal("51000"), low=Decimal("49000"), close=Decimal("50000"))
        expected = (Decimal("51000") + Decimal("49000") + Decimal("50000")) / Decimal("3")
        assert bar.typical_price == expected

    def test_upper_wick(self) -> None:
        # open=50000, close=50500, high=51000
        bar = self._make_ohlcv()
        assert bar.upper_wick == Decimal("51000") - Decimal("50500")

    def test_lower_wick(self) -> None:
        bar = self._make_ohlcv()
        assert bar.lower_wick == Decimal("50000") - Decimal("49000")


class TestOrderBook:
    """Tests for the OrderBook entity."""

    def _make_order_book(self) -> OrderBook:
        return OrderBook(
            symbol="BTC-USDT-SWAP",
            timestamp=datetime(2024, 1, 1),
            bids=[(Decimal("49990"), Decimal("1.5")), (Decimal("49980"), Decimal("2.0"))],
            asks=[(Decimal("50010"), Decimal("1.0")), (Decimal("50020"), Decimal("3.0"))],
        )

    def test_best_bid(self) -> None:
        ob = self._make_order_book()
        assert ob.best_bid == Decimal("49990")

    def test_best_ask(self) -> None:
        ob = self._make_order_book()
        assert ob.best_ask == Decimal("50010")

    def test_spread(self) -> None:
        ob = self._make_order_book()
        assert ob.spread == Decimal("20")

    def test_mid_price(self) -> None:
        ob = self._make_order_book()
        assert ob.mid_price == Decimal("50000")

    def test_empty_book(self) -> None:
        ob = OrderBook(symbol="BTC-USDT-SWAP", timestamp=datetime(2024, 1, 1))
        assert ob.best_bid is None
        assert ob.best_ask is None
        assert ob.spread is None


class TestOrder:
    """Tests for the Order domain entity."""

    def _make_order(self, **kwargs) -> Order:
        defaults = dict(
            symbol="BTC-USDT-SWAP",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal("0.1"),
        )
        defaults.update(kwargs)
        return Order(**defaults)

    def test_valid_market_order(self) -> None:
        order = self._make_order()
        assert order.status == OrderStatus.PENDING
        assert order.is_active is True
        assert order.is_filled is False

    def test_zero_quantity_rejected(self) -> None:
        with pytest.raises(ValueError, match="quantity must be positive"):
            self._make_order(quantity=Decimal("0"))

    def test_limit_order_requires_price(self) -> None:
        with pytest.raises(ValueError, match="Limit orders require a price"):
            self._make_order(order_type=OrderType.LIMIT)

    def test_invalid_leverage(self) -> None:
        with pytest.raises(ValueError, match="Leverage must be between"):
            self._make_order(leverage=0)

    def test_remaining_quantity(self) -> None:
        order = self._make_order(quantity=Decimal("1.0"))
        order.filled_quantity = Decimal("0.4")
        assert order.remaining_quantity == Decimal("0.6")

    def test_notional_value(self) -> None:
        order = self._make_order(quantity=Decimal("1.0"))
        order.average_fill_price = Decimal("50000")
        assert order.notional_value == Decimal("50000")


class TestPosition:
    """Tests for the Position domain entity."""

    def _make_position(self, **kwargs) -> Position:
        defaults = dict(
            symbol="BTC-USDT-SWAP",
            side=PositionSide.LONG,
            quantity=Decimal("0.1"),
            entry_price=Decimal("50000"),
        )
        defaults.update(kwargs)
        return Position(**defaults)

    def test_long_unrealized_pnl_profit(self) -> None:
        pos = self._make_position()
        pos.current_price = Decimal("55000")
        expected = (Decimal("55000") - Decimal("50000")) * Decimal("0.1") * 1
        assert pos.unrealized_pnl == expected

    def test_long_unrealized_pnl_loss(self) -> None:
        pos = self._make_position()
        pos.current_price = Decimal("45000")
        assert pos.unrealized_pnl < Decimal("0")

    def test_short_unrealized_pnl_profit(self) -> None:
        pos = self._make_position(side=PositionSide.SHORT)
        pos.current_price = Decimal("45000")  # price fell = short profits
        expected = (Decimal("50000") - Decimal("45000")) * Decimal("0.1") * 1
        assert pos.unrealized_pnl == expected

    def test_margin_used(self) -> None:
        pos = self._make_position(leverage=10)
        expected = (Decimal("50000") * Decimal("0.1")) / 10
        assert pos.margin_used == expected

    def test_invalid_quantity(self) -> None:
        with pytest.raises(ValueError, match="quantity must be positive"):
            self._make_position(quantity=Decimal("-1"))

    def test_invalid_entry_price(self) -> None:
        with pytest.raises(ValueError, match="Entry price must be positive"):
            self._make_position(entry_price=Decimal("0"))

    def test_update_price(self) -> None:
        pos = self._make_position()
        pos.update_price(Decimal("51000"))
        assert pos.current_price == Decimal("51000")

    def test_update_price_zero_rejected(self) -> None:
        pos = self._make_position()
        with pytest.raises(ValueError, match="Price must be positive"):
            pos.update_price(Decimal("0"))


class TestTradingSignal:
    """Tests for the TradingSignal domain entity."""

    def _make_signal(self, **kwargs) -> TradingSignal:
        defaults = dict(
            symbol="BTC-USDT-SWAP",
            direction=SignalDirection.LONG,
            strength=SignalStrength.STRONG,
            timeframe=Timeframe.H4,
            entry_price=Decimal("50000"),
            stop_loss_price=Decimal("49000"),
            take_profit_price=Decimal("52000"),
            confidence_score=0.8,
            source="test",
        )
        defaults.update(kwargs)
        return TradingSignal(**defaults)

    def test_risk_reward_long(self) -> None:
        signal = self._make_signal()
        # reward = 52000 - 50000 = 2000, risk = 50000 - 49000 = 1000
        assert signal.risk_reward_ratio == Decimal("2")

    def test_risk_reward_short(self) -> None:
        signal = self._make_signal(
            direction=SignalDirection.SHORT,
            stop_loss_price=Decimal("51000"),
            take_profit_price=Decimal("48000"),
        )
        # reward = 50000 - 48000 = 2000, risk = 51000 - 50000 = 1000
        assert signal.risk_reward_ratio == Decimal("2")

    def test_invalid_confidence(self) -> None:
        with pytest.raises(ValueError, match="Confidence score"):
            self._make_signal(confidence_score=1.5)

    def test_is_actionable_high_confidence(self) -> None:
        signal = self._make_signal(confidence_score=0.7)
        assert signal.is_actionable is True

    def test_is_actionable_low_confidence(self) -> None:
        signal = self._make_signal(confidence_score=0.4)
        assert signal.is_actionable is False

    def test_neutral_not_actionable(self) -> None:
        signal = self._make_signal(
            direction=SignalDirection.NEUTRAL,
            confidence_score=0.9,
            # neutral signal needs symmetric stop/tp so SL < entry for comparison
            stop_loss_price=Decimal("48000"),
            take_profit_price=Decimal("52000"),
        )
        assert signal.is_actionable is False


class TestSentimentData:
    """Tests for the SentimentData domain entity."""

    def test_valid_sentiment(self) -> None:
        s = SentimentData(
            symbol="BTC",
            score=0.5,
            label=SentimentLabel.BULLISH,
            source="test",
        )
        assert s.score == 0.5

    def test_invalid_score(self) -> None:
        with pytest.raises(ValueError, match="Sentiment score"):
            SentimentData(
                symbol="BTC",
                score=1.5,
                label=SentimentLabel.BULLISH,
                source="test",
            )

    def test_invalid_fear_greed(self) -> None:
        with pytest.raises(ValueError, match="Fear & Greed"):
            SentimentData(
                symbol="BTC",
                score=0.0,
                label=SentimentLabel.NEUTRAL,
                source="test",
                fear_greed_index=101,
            )
