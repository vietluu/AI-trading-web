import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../../session/session.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
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
  async validate(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = body as {
      provider: ExchangeProvider;
      symbol: string;
      interval: ExchangeInterval;
      lookbackCandles: number;
      initialBalance: number;
      trainWindow?: number;
      validationWindow?: number;
      strategyKey?: string;
    };
    return this.researchService.runFullQuantValidation({ ...input, userId: user.id });
  }

  @Post('validate-full')
  async validateFull(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = body as {
      provider: ExchangeProvider;
      symbol: string;
      interval: ExchangeInterval;
      lookbackCandles: number;
      initialBalance: number;
      trainWindow?: number;
      validationWindow?: number;
      strategyKey?: string;
    };
    return this.researchService.runFullQuantValidation({ ...input, userId: user.id });
  }

  @Post('sensitivity')
  async sensitivity(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = body as {
      provider: ExchangeProvider;
      symbol: string;
      interval: ExchangeInterval;
      lookbackCandles: number;
      parameterName: 'confidenceFloor' | 'riskRewardRatio' | 'atrMultiplier' | 'rsiPeriod';
      gridValues?: number[];
    };
    return this.researchService.runSensitivityAnalysis({ ...input, userId: user.id });
  }

  @Post('benchmark')
  async benchmark(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = body as {
      provider: ExchangeProvider;
      symbol: string;
      interval: ExchangeInterval;
      lookbackCandles: number;
      initialBalance: number;
      leverage: number;
      riskPerTrade: number;
      riskRewardRatio: number;
    };
    return this.researchService.runBenchmarkAnalysis({ ...input, userId: user.id });
  }

  @Get('health')
  health() {
    return { status: 'ok', module: 'research' };
  }
}
