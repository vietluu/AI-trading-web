import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RiskLimits } from "../domain/risk-engine";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class RiskConfigService {
  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  get values(): RiskLimits {
    return this.defaultLimits();
  }

  private defaultLimits(): RiskLimits {
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

  async getUserLimits(userId?: string): Promise<RiskLimits> {
    const defaults = this.defaultLimits();
    if (!userId || !this.prisma) return defaults;

    try {
      const setting = await this.prisma.userSetting.findUnique({
        where: { userId },
      });
      if (!setting) return defaults;

      let riskPerTrade = defaults.riskPerTrade;
      let maxExposure = defaults.maxExposure;
      let stopLossPct = defaults.stopLossPct;

      if (setting.riskPreference === "CONSERVATIVE") {
        riskPerTrade = 0.01;
        maxExposure = 0.4;
        stopLossPct = 0.015;
      } else if (setting.riskPreference === "MODERATE") {
        riskPerTrade = 0.02;
        maxExposure = 0.6;
        stopLossPct = 0.02;
      } else if (setting.riskPreference === "AGGRESSIVE") {
        riskPerTrade = 0.04;
        maxExposure = 0.8;
        stopLossPct = 0.03;
      }

      const userLeverage = setting.defaultLeverage
        ? Math.min(Math.max(1, setting.defaultLeverage), 125)
        : defaults.maxLeverage;

      return {
        ...defaults,
        riskPerTrade,
        maxExposure,
        stopLossPct,
        maxLeverage: userLeverage,
      };
    } catch {
      return defaults;
    }
  }
}
