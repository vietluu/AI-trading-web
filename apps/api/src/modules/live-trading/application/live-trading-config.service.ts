import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ExchangeEnvironment } from "../../../exchange/domain/exchange.types";

@Injectable()
export class LiveTradingConfigService {
  private runtimeEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.runtimeEnabled =
      config.get<boolean>("GLOBAL_TRADING_ENABLED") ?? false;
  }

  get values() {
    const cautionSymbols = (
      this.config.get<string>("CAUTION_SYMBOLS") ?? "LINK-USDT,ETH-USDT"
    )
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    return {
      mode: this.config.get<"DEMO" | "LIVE">("TRADING_MODE") ?? "DEMO",
      liveEnabled: this.config.get<boolean>("LIVE_TRADING_ENABLED") ?? false,
      syncEnabled:
        this.config.get<boolean>("LIVE_POSITION_SYNC_ENABLED") ?? true,
      syncIntervalMs:
        this.config.get<number>("LIVE_POSITION_SYNC_INTERVAL_MS") ?? 5_000,
      cooldownMs: this.config.get<number>("TRADE_COOLDOWN_MS") ?? 60_000,
      approvalTtlMs:
        this.config.get<number>("LIVE_RISK_APPROVAL_TTL_MS") ?? 300_000,
      runtimeEnabled: this.runtimeEnabled,
      symbolExecutionPolicy: {
        cautionSymbols,
        minimumTrades:
          this.config.get<number>("CAUTION_SYMBOL_MIN_TRADES") ?? 5,
        minimumWinRate:
          this.config.get<number>("CAUTION_SYMBOL_MIN_WIN_RATE") ?? 0.45,
        minimumProfitFactor:
          this.config.get<number>("CAUTION_SYMBOL_MIN_PROFIT_FACTOR") ?? 1.1,
        strongSignalConfidence:
          this.config.get<number>("CAUTION_SYMBOL_STRONG_CONFIDENCE") ?? 80,
        strongSignalOpportunity:
          this.config.get<number>("CAUTION_SYMBOL_STRONG_OPPORTUNITY") ?? 75,
        strongSignalExpectedValue:
          this.config.get<number>("CAUTION_SYMBOL_STRONG_EXPECTED_VALUE") ??
          0.12,
        sizeFactor:
          this.config.get<number>("CAUTION_SYMBOL_SIZE_FACTOR") ?? 0.5,
      },
    } as const;
  }

  assertExecutionAllowed(environment: ExchangeEnvironment): void {
    const { mode, liveEnabled } = this.values;
    if (!this.runtimeEnabled)
      throw new ServiceUnavailableException(
        "Global trading kill switch is active",
      );
    if (mode !== "DEMO" && mode !== "LIVE") {
      throw new ForbiddenException(
        "Real execution is unavailable in the configured trading mode",
      );
    }
    if (mode === "LIVE") {
      if (!liveEnabled)
        throw new ForbiddenException("Live trading is not explicitly enabled");
      if (environment !== ExchangeEnvironment.PRODUCTION)
        throw new ForbiddenException(
          "LIVE mode requires a production connection",
        );
    } else if (environment === ExchangeEnvironment.PRODUCTION) {
      throw new ForbiddenException(
        "DEMO mode cannot use a production connection",
      );
    }
  }

  kill(): void {
    this.runtimeEnabled = false;
  }

  enable(): void {
    this.runtimeEnabled = true;
  }
}
