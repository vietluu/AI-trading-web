import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../../session/session.guard';
import { ResearchService } from '../application/research.service';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';

@Controller('ai/research')
@UseGuards(SessionGuard)
export class ResearchController {
  constructor(private readonly researchService: ResearchService) {}

  @Post('backtest')
  async runBacktest(@Body() body: unknown) {
    const input = body as {
      provider: ExchangeProvider;
      symbol: string;
      interval: ExchangeInterval;
      lookbackCandles: number;
      initialBalance: number;
      leverage: number;
      riskPerTrade: number;
      riskRewardRatio: number;
      strategyName?: string;
    };
    return this.researchService.runBacktest(input);
  }

  @Post('validate')
  async validate(@Body() body: unknown) {
    const input = body as {
      provider: ExchangeProvider;
      symbol: string;
      interval: ExchangeInterval;
      lookbackCandles: number;
      initialBalance: number;
      trainWindow: number;
      validationWindow: number;
    };
    return this.researchService.runValidation(input);
  }

  @Get('health')
  health() {
    return { status: 'ok', module: 'research' };
  }
}
