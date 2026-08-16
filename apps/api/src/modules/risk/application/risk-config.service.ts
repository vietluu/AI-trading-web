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
      riskPerTrade: Math.min(this.config.get<number>("RISK_PER_TRADE") ?? 0.005, 0.02),
      maxPositions: this.config.get<number>("MAX_POSITIONS") ?? 3,
      maxLeverage: this.config.get<number>("MAX_LEVERAGE") ?? 50,
      maxDrawdown: this.config.get<number>("MAX_DRAWDOWN") ?? 0.15,
      maxExposure: this.config.get<number>("MAX_EXPOSURE") ?? 0.6,
      cooldownMs: this.config.get<number>("TRADE_COOLDOWN_MS") ?? 60_000,
      lossReentryCooldownMs:
        this.config.get<number>("LOSS_REENTRY_COOLDOWN_MS") ?? 900_000,
      minimumConfidence: this.config.get<number>("MIN_CONFIDENCE") ?? 60,
      stopLossPct: this.config.get<number>("STOP_LOSS_PCT") ?? 0.02,
      riskRewardRatio: this.config.get<number>("RISK_REWARD_RATIO") ?? 1.5,
      highVolatility:
        this.config.get<number>("HIGH_VOLATILITY_THRESHOLD") ?? 0.04,
      abnormalVolatility:
        this.config.get<number>("ABNORMAL_VOLATILITY_THRESHOLD") ?? 0.15,
      highVolatilitySizeFactor:
        this.config.get<number>("HIGH_VOLATILITY_SIZE_FACTOR") ?? 0.6,
      estimatedRoundTripCostPct:
        this.config.get<number>("ESTIMATED_ROUND_TRIP_COST_PCT") ?? 0.001,
      maxRoundTripCostToStopRatio:
        this.config.get<number>("MAX_ROUND_TRIP_COST_TO_STOP_RATIO") ?? 0.35,
      maxStopLossRoe:
        this.config.get<number>("MAX_STOP_LOSS_ROE") ?? 0.03,
      rangeScalpRoeMultiplier:
        this.config.get<number>("RANGE_SCALP_ROE_MULTIPLIER") ?? 2,
      minLiquidationBufferPct:
        this.config.get<number>("MIN_LIQUIDATION_BUFFER_PCT") ?? 0.01,
    };
  }

  async getUserLimits(userId?: string): Promise<RiskLimits> {
    const defaults = this.defaultLimits();
    if (!userId || !this.prisma) return defaults;
    // Missing preference data must not expose a user to a permissive global
    // leverage setting. Use the conservative execution default until the
    // user's explicit hard ceiling can be loaded.
    const defaultExecutionLeverage =
      this.config.get<number>("DEFAULT_LEVERAGE") ?? 3;
    const safeUserDefaults: RiskLimits = {
      ...defaults,
      riskPerTrade: Math.min(defaults.riskPerTrade, 0.02),
      maxExposure: Math.min(defaults.maxExposure, 0.6),
      stopLossPct: Math.min(defaults.stopLossPct, 0.02),
      maxLeverage: Math.min(defaults.maxLeverage, defaultExecutionLeverage),
    };

    try {
      const setting = await this.prisma.userSetting.findUnique({
        where: { userId },
      });
      if (!setting) return safeUserDefaults;

      let preferredRiskPerTrade = defaults.riskPerTrade;
      let maxExposure = defaults.maxExposure;
      let stopLossPct = defaults.stopLossPct;

      if (setting.riskPreference === "CONSERVATIVE") {
        preferredRiskPerTrade = 0.01;
        maxExposure = 0.4;
        stopLossPct = 0.015;
      } else if (setting.riskPreference === "MODERATE") {
        preferredRiskPerTrade = 0.02;
        maxExposure = 0.6;
        stopLossPct = 0.02;
      } else if (setting.riskPreference === "AGGRESSIVE") {
        preferredRiskPerTrade = 0.02;
        maxExposure = 0.8;
        stopLossPct = 0.03;
      }

      const requestedLeverage = setting.defaultLeverage
        ? Math.min(Math.max(1, setting.defaultLeverage), 125)
        : defaults.maxLeverage;
      // The stored leverage is a hard ceiling, not the leverage used blindly.
      // RiskEngine derives the actual value from stop, strategy and liquidation.
      const userLeverage = Math.min(requestedLeverage, defaults.maxLeverage);
      const hardRiskCeiling = Math.min(
        0.02,
        Math.max(0.001, Number(setting.maxRiskPerTrade ?? 0.02)),
      );

      return {
        ...defaults,
        // The deployment-wide value is a hard ceiling. A user preference can
        // make execution safer, but cannot silently raise live risk above it.
        riskPerTrade: Math.min(
          preferredRiskPerTrade,
          defaults.riskPerTrade,
          hardRiskCeiling,
        ),
        maxExposure,
        stopLossPct,
        maxLeverage: userLeverage,
      };
    } catch {
      return safeUserDefaults;
    }
  }
}
