import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../../session/session.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ResearchService } from '../application/research.service';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { z } from 'zod';
import { ResearchRateLimitGuard } from './research-rate-limit.guard';

const provider = z.nativeEnum(ExchangeProvider);
const interval = z.nativeEnum(ExchangeInterval);
const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9]+-[A-Z0-9]+$/);
const lookbackCandles = z.coerce.number().int().min(100).max(1500);
const initialBalance = z.coerce.number().positive().max(100_000_000);
const executionSchema = z.object({
  provider,
  symbol,
  interval,
  lookbackCandles,
  initialBalance,
  leverage: z.coerce.number().min(1).max(50),
  riskPerTrade: z.coerce.number().min(0.0001).max(0.05),
  riskRewardRatio: z.coerce.number().min(1).max(10),
});
const validationSchema = z.object({
  provider,
  symbol,
  interval,
  lookbackCandles: lookbackCandles.refine((value) => value >= 300),
  initialBalance,
  trainWindow: z.coerce.number().int().min(50).max(1000).optional(),
  validationWindow: z.coerce.number().int().min(10).max(500).optional(),
  strategyKey: z.string().trim().min(1).max(64).optional(),
});

@Controller('ai/research')
@UseGuards(SessionGuard, ResearchRateLimitGuard)
export class ResearchController {
  constructor(private readonly researchService: ResearchService) {}

  @Post('backtest')
  async runBacktest(@Body() body: unknown) {
    const input = executionSchema.extend({ strategyName: z.string().trim().min(1).max(80).optional() }).parse(body);
    return this.researchService.runBacktest(input);
  }

  @Post('validate')
  async validate(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = validationSchema.parse(body);
    return this.researchService.runFullQuantValidation({ ...input, userId: user.id });
  }

  @Post('validate-full')
  async validateFull(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = validationSchema.parse(body);
    return this.researchService.runFullQuantValidation({ ...input, userId: user.id });
  }

  @Post('refresh-validations')
  async refreshValidations(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = z.object({
      provider,
      symbols: z.array(symbol).min(1).max(10),
      interval,
      strategyKeys: z.array(z.string().trim().min(1).max(64)).min(1).max(5),
      lookbackCandles: lookbackCandles.refine((value) => value >= 300).optional(),
    }).parse(body);
    return this.researchService.refreshFullQuantValidations({ ...input, userId: user.id });
  }

  @Post('sensitivity')
  async sensitivity(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = z.object({
      provider,
      symbol,
      interval,
      lookbackCandles,
      parameterName: z.enum(['confidenceFloor', 'riskRewardRatio', 'atrMultiplier', 'rsiPeriod']),
      gridValues: z.array(z.number().finite().min(-100).max(1000)).min(1).max(20).optional(),
    }).parse(body);
    return this.researchService.runSensitivityAnalysis({ ...input, userId: user.id });
  }

  @Post('benchmark')
  async benchmark(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = executionSchema.parse(body);
    return this.researchService.runBenchmarkAnalysis({ ...input, userId: user.id });
  }

  @Get('health')
  health() {
    return { status: 'ok', module: 'research' };
  }
}
