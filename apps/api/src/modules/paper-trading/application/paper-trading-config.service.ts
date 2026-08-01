import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TradingMode } from '@platform/shared';

@Injectable()
export class PaperTradingConfigService {
  constructor(private readonly config: ConfigService) {}
  get values() {
    return {
      enabled: this.config.get<boolean>('PAPER_TRADING_ENABLED') ?? true,
      mode: this.config.get<TradingMode>('TRADING_MODE') ?? 'SIGNAL_ONLY',
      initialBalance: this.config.get<number>('PAPER_INITIAL_BALANCE') ?? 10_000,
      riskPerTrade: this.config.get<number>('RISK_PER_TRADE') ?? 0.02,
      leverage: this.config.get<number>('DEFAULT_LEVERAGE') ?? 3,
      feeRate: this.config.get<number>('TAKER_FEE') ?? 0.0004,
      slippageMin: this.config.get<number>('SLIPPAGE_MIN') ?? 0.0002,
      slippageMax: this.config.get<number>('SLIPPAGE_MAX') ?? 0.001,
      cooldownMs: this.config.get<number>('TRADE_COOLDOWN_MS') ?? 60_000,
      stopLoss: this.config.get<number>('STOP_LOSS_PCT') ?? 0.02,
      takeProfit: this.config.get<number>('TAKE_PROFIT_PCT') ?? 0.04,
    } as const;
  }
}
