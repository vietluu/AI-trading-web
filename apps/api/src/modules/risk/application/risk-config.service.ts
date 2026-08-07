import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RiskLimits } from "../domain/risk-engine";

@Injectable()
export class RiskConfigService {
  constructor(private readonly config: ConfigService) {}

  get values(): RiskLimits {
    return {
      riskPerTrade: this.config.get<number>("RISK_PER_TRADE") ?? 0.02,
      maxPositions: this.config.get<number>("MAX_POSITIONS") ?? 10,
      maxLeverage: this.config.get<number>("MAX_LEVERAGE") ?? 50,
      maxDrawdown: this.config.get<number>("MAX_DRAWDOWN") ?? 0.15,
      maxExposure: this.config.get<number>("MAX_EXPOSURE") ?? 0.6,
      cooldownMs: this.config.get<number>("TRADE_COOLDOWN_MS") ?? 60_000,
      minimumConfidence: this.config.get<number>("MIN_CONFIDENCE") ?? 60,
      stopLossPct: this.config.get<number>("STOP_LOSS_PCT") ?? 0.02,
      riskRewardRatio: this.config.get<number>("RISK_REWARD_RATIO") ?? 1.5,
      highVolatility:
        this.config.get<number>("HIGH_VOLATILITY_THRESHOLD") ?? 0.04,
      abnormalVolatility:
        this.config.get<number>("ABNORMAL_VOLATILITY_THRESHOLD") ?? 0.15,
      highVolatilitySizeFactor:
        this.config.get<number>("HIGH_VOLATILITY_SIZE_FACTOR") ?? 0.6,
    };
  }
}
