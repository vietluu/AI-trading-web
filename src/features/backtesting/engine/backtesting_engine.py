"""Backtesting engine for strategy evaluation.

Simulates a strategy over historical OHLCV data and produces
performance metrics including Sharpe ratio, max drawdown, win rate,
and profit factor.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

import pandas as pd

from src.core.domain.entities.market_data import OHLCV
from src.core.domain.entities.trading import Position
from src.core.domain.value_objects.enums import (
    PositionSide,
    Timeframe,
)
from src.core.logging import get_logger
from src.features.ai_analysis.analyzers.technical_analyzer import TechnicalAnalyzer

logger = get_logger(__name__)

MAKER_FEE = Decimal("0.0002")
TAKER_FEE = Decimal("0.0005")


@dataclass
class Trade:
    """A single completed trade during a backtest.

    Attributes:
        symbol: Trading pair symbol.
        side: LONG or SHORT.
        entry_price: Trade entry price.
        exit_price: Trade exit price.
        quantity: Position size in base currency.
        pnl: Net profit/loss (after commissions).
        commission: Total commission paid.
        entry_time: Trade entry timestamp.
        exit_time: Trade exit timestamp.
        exit_reason: Why the trade was closed (stop_loss, take_profit, signal, end_of_data).
        leverage: Applied leverage.
    """

    symbol: str
    side: PositionSide
    entry_price: Decimal
    exit_price: Decimal
    quantity: Decimal
    pnl: Decimal
    commission: Decimal
    entry_time: datetime
    exit_time: datetime
    exit_reason: str
    leverage: int = 1

    @property
    def return_pct(self) -> float:
        """Trade return as percentage."""
        if self.entry_price <= Decimal("0"):
            return 0.0
        if self.side == PositionSide.LONG:
            return float((self.exit_price - self.entry_price) / self.entry_price * 100)
        return float((self.entry_price - self.exit_price) / self.entry_price * 100)

    @property
    def is_win(self) -> bool:
        """Return True if the trade was profitable."""
        return self.pnl > Decimal("0")


@dataclass
class BacktestResult:
    """Complete results from a backtesting run.

    Attributes:
        id: Unique result identifier.
        strategy_name: Name of the tested strategy.
        symbol: Tested trading pair.
        timeframe: Candle interval used.
        start_date: Backtest start date.
        end_date: Backtest end date.
        initial_capital: Starting capital in USDT.
        final_capital: Ending equity.
        trades: List of completed trades.
        equity_curve: Time-series of portfolio equity.
        parameters: Strategy parameters used.
    """

    id: str
    strategy_name: str
    symbol: str
    timeframe: Timeframe
    start_date: datetime
    end_date: datetime
    initial_capital: float
    final_capital: float
    trades: list[Trade]
    equity_curve: list[dict[str, Any]]
    parameters: dict[str, Any]

    @property
    def total_return_pct(self) -> float:
        """Total return as percentage."""
        if self.initial_capital <= 0:
            return 0.0
        return (self.final_capital - self.initial_capital) / self.initial_capital * 100

    @property
    def total_trades(self) -> int:
        return len(self.trades)

    @property
    def winning_trades(self) -> int:
        return sum(1 for t in self.trades if t.is_win)

    @property
    def losing_trades(self) -> int:
        return self.total_trades - self.winning_trades

    @property
    def win_rate(self) -> float:
        if self.total_trades == 0:
            return 0.0
        return self.winning_trades / self.total_trades

    @property
    def avg_win_pct(self) -> float:
        wins = [t.return_pct for t in self.trades if t.is_win]
        return sum(wins) / len(wins) if wins else 0.0

    @property
    def avg_loss_pct(self) -> float:
        losses = [abs(t.return_pct) for t in self.trades if not t.is_win]
        return sum(losses) / len(losses) if losses else 0.0

    @property
    def profit_factor(self) -> float:
        gross_win = sum(float(t.pnl) for t in self.trades if t.is_win)
        gross_loss = abs(sum(float(t.pnl) for t in self.trades if not t.is_win))
        return gross_win / gross_loss if gross_loss > 0 else float("inf")

    @property
    def max_drawdown_pct(self) -> float:
        """Maximum drawdown percentage from the equity curve."""
        if not self.equity_curve:
            return 0.0
        equities = [p["equity"] for p in self.equity_curve]
        peak = equities[0]
        max_dd = 0.0
        for eq in equities:
            peak = max(peak, eq)
            dd = (peak - eq) / peak if peak > 0 else 0.0
            max_dd = max(max_dd, dd)
        return max_dd * 100

    @property
    def sharpe_ratio(self) -> float:
        """Annualized Sharpe ratio from trade returns (risk-free rate = 0)."""
        returns = [t.return_pct / 100 for t in self.trades]
        if len(returns) < 2:
            return 0.0
        mean_r = sum(returns) / len(returns)
        variance = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
        std_r = math.sqrt(variance)
        if std_r == 0:
            return 0.0
        annualization_factor = math.sqrt(252)
        return (mean_r / std_r) * annualization_factor

    def to_summary(self) -> dict[str, Any]:
        """Return a summary dict for API responses and DB storage."""
        return {
            "id": self.id,
            "strategy_name": self.strategy_name,
            "symbol": self.symbol,
            "timeframe": self.timeframe.value,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "initial_capital": self.initial_capital,
            "final_capital": self.final_capital,
            "total_return_pct": round(self.total_return_pct, 2),
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": round(self.win_rate * 100, 2),
            "avg_win_pct": round(self.avg_win_pct, 2),
            "avg_loss_pct": round(self.avg_loss_pct, 2),
            "profit_factor": round(self.profit_factor, 2),
            "max_drawdown_pct": round(self.max_drawdown_pct, 2),
            "sharpe_ratio": round(self.sharpe_ratio, 3),
        }


class BacktestingEngine:
    """Runs strategy simulations over historical OHLCV data.

    Uses a vectorized-compatible approach: iterates bar-by-bar to
    support complex multi-condition entry/exit strategies.

    Args:
        technical_analyzer: For computing indicators on rolling windows.
        initial_capital: Starting portfolio value in USDT.
        risk_pct: Capital to risk per trade as fraction.
        stop_loss_pct: Default stop loss percentage.
        take_profit_pct: Default take profit percentage.
        leverage: Futures leverage.
        commission_rate: Per-trade commission rate (taker).
    """

    def __init__(
        self,
        technical_analyzer: TechnicalAnalyzer,
        initial_capital: float = 10_000.0,
        risk_pct: float = 0.02,
        stop_loss_pct: float = 0.02,
        take_profit_pct: float = 0.04,
        leverage: int = 1,
        commission_rate: float = 0.0005,
    ) -> None:
        self._technical = technical_analyzer
        self._initial_capital = initial_capital
        self._risk_pct = risk_pct
        self._sl_pct = stop_loss_pct
        self._tp_pct = take_profit_pct
        self._leverage = leverage
        self._commission_rate = Decimal(str(commission_rate))

    def run(
        self,
        bars: list[OHLCV],
        strategy_name: str = "technical_rsi_macd",
        parameters: dict[str, Any] | None = None,
    ) -> BacktestResult:
        """Run a backtest over the provided OHLCV bars.

        The built-in strategy uses RSI + MACD confluence:
        - Long: RSI < 40, MACD > signal, EMA9 > EMA21
        - Short: RSI > 60, MACD < signal, EMA9 < EMA21
        - Exit: stop-loss, take-profit, or opposing signal

        Args:
            bars: Historical OHLCV bars (sorted oldest first).
            strategy_name: Human-readable strategy identifier.
            parameters: Optional strategy parameter overrides.

        Returns:
            BacktestResult with full performance metrics.

        Raises:
            ValueError: If there are insufficient bars.
        """
        params = parameters or {}
        sl_pct = Decimal(str(params.get("stop_loss_pct", self._sl_pct)))
        tp_pct = Decimal(str(params.get("take_profit_pct", self._tp_pct)))
        lookback = params.get("lookback_bars", 50)

        if len(bars) < lookback + 10:
            raise ValueError(
                f"Need at least {lookback + 10} bars for backtest, got {len(bars)}"
            )

        capital = Decimal(str(self._initial_capital))
        trades: list[Trade] = []
        equity_curve: list[dict[str, Any]] = []
        open_position: Position | None = None
        sl_price: Decimal | None = None
        tp_price: Decimal | None = None

        for i in range(lookback, len(bars)):
            window = bars[max(0, i - 200): i + 1]
            current_bar = bars[i]
            current_price = current_bar.close

            # Build DataFrame for indicators
            df_data = [
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
                for b in window
            ]
            df = pd.DataFrame(df_data).set_index("timestamp")

            if len(df) < 50:
                continue

            try:
                ind = self._technical.compute(df)
            except ValueError:
                continue

            equity_curve.append(
                {
                    "timestamp": current_bar.timestamp.isoformat(),
                    "price": float(current_price),
                    "equity": float(capital)
                    + (float(open_position.unrealized_pnl) if open_position else 0.0),
                }
            )

            # Check exit conditions for open position
            if open_position is not None:
                open_position.update_price(current_price)
                exit_reason = None

                if sl_price and self._should_stop(open_position, current_price, sl_price):
                    exit_price = sl_price
                    exit_reason = "stop_loss"
                elif tp_price and self._should_tp(open_position, current_price, tp_price):
                    exit_price = tp_price
                    exit_reason = "take_profit"

                if exit_reason:
                    trade = self._close_trade(
                        open_position,
                        exit_price,  # type: ignore[possibly-undefined]
                        capital,
                        exit_reason,
                    )
                    trades.append(trade)
                    capital = self._update_capital(capital, open_position, exit_price, trade)
                    open_position = None
                    sl_price = None
                    tp_price = None
                    continue

            # Check entry signals (only when no open position)
            if open_position is None and ind.rsi_14 and ind.macd and ind.macd_signal:
                entry_side = None

                # Long signal
                if (
                    ind.rsi_14 < 40
                    and ind.macd > ind.macd_signal
                    and ind.ema_9 is not None
                    and ind.ema_21 is not None
                    and ind.ema_9 > ind.ema_21
                ):
                    entry_side = PositionSide.LONG

                # Short signal
                elif (
                    ind.rsi_14 > 60
                    and ind.macd < ind.macd_signal
                    and ind.ema_9 is not None
                    and ind.ema_21 is not None
                    and ind.ema_9 < ind.ema_21
                ):
                    entry_side = PositionSide.SHORT

                if entry_side is not None:
                    risk_amount = capital * Decimal(str(self._risk_pct))
                    if entry_side == PositionSide.LONG:
                        sl = current_price * (Decimal("1") - sl_pct)
                        tp = current_price * (Decimal("1") + tp_pct)
                    else:
                        sl = current_price * (Decimal("1") + sl_pct)
                        tp = current_price * (Decimal("1") - tp_pct)

                    stop_dist = abs(current_price - sl)
                    if stop_dist <= Decimal("0"):
                        continue

                    qty = (risk_amount / stop_dist).quantize(Decimal("0.0001"))
                    commission = qty * current_price * self._commission_rate
                    margin = qty * current_price / self._leverage

                    if margin + commission > capital:
                        continue

                    capital -= margin + commission

                    open_position = Position(
                        symbol=current_bar.symbol,
                        side=entry_side,
                        quantity=qty,
                        entry_price=current_price,
                        leverage=self._leverage,
                        commission=commission,
                        opened_at=current_bar.timestamp,
                    )
                    open_position.current_price = current_price
                    sl_price = sl
                    tp_price = tp

        # Close any remaining open position at end of data
        if open_position is not None:
            last_price = bars[-1].close
            open_position.update_price(last_price)
            trade = self._close_trade(open_position, last_price, capital, "end_of_data")
            trades.append(trade)
            capital = self._update_capital(capital, open_position, last_price, trade)

        return BacktestResult(
            id=str(uuid.uuid4()),
            strategy_name=strategy_name,
            symbol=bars[0].symbol if bars else "",
            timeframe=bars[0].timeframe if bars else Timeframe.H4,
            start_date=bars[lookback].timestamp if len(bars) > lookback else bars[0].timestamp,
            end_date=bars[-1].timestamp if bars else datetime.utcnow(),
            initial_capital=self._initial_capital,
            final_capital=float(capital),
            trades=trades,
            equity_curve=equity_curve,
            parameters={
                "stop_loss_pct": float(sl_pct),
                "take_profit_pct": float(tp_pct),
                "risk_pct": self._risk_pct,
                "leverage": self._leverage,
            },
        )

    def _close_trade(
        self,
        position: Position,
        exit_price: Decimal,
        capital: Decimal,
        reason: str,
    ) -> Trade:
        """Build a Trade record for a closed position."""
        commission = position.quantity * exit_price * self._commission_rate
        if position.side == PositionSide.LONG:
            gross_pnl = (exit_price - position.entry_price) * position.quantity
        else:
            gross_pnl = (position.entry_price - exit_price) * position.quantity

        gross_pnl *= self._leverage
        net_pnl = gross_pnl - commission - position.commission

        return Trade(
            symbol=position.symbol,
            side=position.side,
            entry_price=position.entry_price,
            exit_price=exit_price,
            quantity=position.quantity,
            pnl=net_pnl,
            commission=commission + position.commission,
            entry_time=position.opened_at,
            exit_time=datetime.utcnow(),
            exit_reason=reason,
            leverage=self._leverage,
        )

    def _update_capital(
        self,
        capital: Decimal,
        position: Position,
        exit_price: Decimal,
        trade: Trade,
    ) -> Decimal:
        """Return margin + net P&L to capital."""
        margin = position.quantity * position.entry_price / self._leverage
        return capital + margin + trade.pnl

    @staticmethod
    def _should_stop(position: Position, price: Decimal, sl: Decimal) -> bool:
        if position.side == PositionSide.LONG:
            return price <= sl
        return price >= sl

    @staticmethod
    def _should_tp(position: Position, price: Decimal, tp: Decimal) -> bool:
        if position.side == PositionSide.LONG:
            return price >= tp
        return price <= tp
