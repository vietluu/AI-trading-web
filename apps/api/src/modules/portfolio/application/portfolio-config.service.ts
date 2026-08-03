import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PortfolioLimits } from "../domain/portfolio-engine";

@Injectable()
export class PortfolioConfigService {
  constructor(private readonly config: ConfigService) {}

  get values(): PortfolioLimits & { rebalanceIntervalMs: number } {
    return {
      maxStrategies: this.config.get<number>("MAX_STRATEGIES") ?? 5,
      maxTotalExposure: this.config.get<number>("MAX_TOTAL_EXPOSURE") ?? 0.6,
      maxStrategyExposure:
        this.config.get<number>("MAX_STRATEGY_EXPOSURE") ?? 0.25,
      maxDrawdown: this.config.get<number>("MAX_DRAWDOWN_PORTFOLIO") ?? 0.2,
      disableMinTrades:
        this.config.get<number>("STRATEGY_DISABLE_MIN_TRADES") ?? 10,
      disableReturnPct:
        this.config.get<number>("STRATEGY_DISABLE_RETURN_PCT") ?? -0.1,
      disableWinRate:
        this.config.get<number>("STRATEGY_DISABLE_WIN_RATE") ?? 0.35,
      rebalanceIntervalMs:
        this.config.get<number>("PORTFOLIO_REBALANCE_INTERVAL_MS") ?? 3_600_000,
    };
  }

  get tradingMode(): "DEMO" | "LIVE" {
    return this.config.get<"DEMO" | "LIVE">("TRADING_MODE") ?? "DEMO";
  }

  get liveStaleAfterMs(): number {
    return (
      (this.config.get<number>("LIVE_POSITION_SYNC_INTERVAL_MS") ?? 30_000) * 2
    );
  }
}
