import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedTaskLockService } from '../../../redis/distributed-task-lock.service';
import { QuantIntelligenceService } from './quant-intelligence.service';
import { ResearchService } from './research.service';
import { ExchangeProvider } from '../../../exchange/domain/exchange.types';

const REFRESH_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class QuantResearchSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QuantResearchSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private validationCursor = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quant: QuantIntelligenceService,
    private readonly research: ResearchService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => void this.sweep(), REFRESH_INTERVAL_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.taskLock) {
      await this.taskLock.run('quant-research-refresh', 240, () => this.sweepOnce());
      return;
    }
    await this.sweepOnce();
  }

  private async sweepOnce(): Promise<void> {
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const [settingsUsers, pipelineUsers] = await Promise.all([
      this.prisma.userSetting.findMany({
        where: { preferredSymbols: { isEmpty: false } },
        select: { userId: true },
      }),
      this.prisma.pipelineRun.findMany({
        where: { createdAt: { gte: recentCutoff } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);
    const userIds = [...new Set([...settingsUsers, ...pipelineUsers].map((item) => item.userId))];
    let symbols = 0;
    let unavailable = 0;
    let validations = 0;
    let validationAttempts = 0;
    const validationCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const maxValidationsPerSweep = 8;
    for (const userId of userIds) {
      try {
        const result = await this.quant.generateSelectedHypotheses(userId);
        symbols += result.symbols.length;
        unavailable += result.hypotheses.filter((item) => item.status === 'DATA_UNAVAILABLE').length;
        if (validationAttempts >= maxValidationsPerSweep) continue;
        const scope = await this.quant.getSelectedResearchScope(userId);
        if (!scope.symbols.length || !scope.timeframes.length) continue;
        const connections = await this.prisma.exchangeConnection.findMany({
          where: { userId, isEnabled: true, isVerified: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!connections.length) continue;
        const latestRows = await this.prisma.researchValidationRun.findMany({
          where: { userId, symbol: { in: scope.symbols }, interval: { in: scope.timeframes } },
          orderBy: { createdAt: 'desc' },
        });
        const latestByPair = new Map<string, Date>();
        for (const row of latestRows) {
          const key = `${row.strategyKey}:${row.symbol}:${row.interval}`;
          if (!latestByPair.has(key)) latestByPair.set(key, row.createdAt);
        }
        const strategyKeys = ['ai-core', 'trend', 'mean-reversion', 'breakout', 'momentum-scalp'];
        const candidates = strategyKeys.flatMap((strategyKey) =>
          scope.symbols.flatMap((symbol) => scope.timeframes.map((interval) => ({ strategyKey, symbol, interval }))));
        const start = candidates.length ? this.validationCursor % candidates.length : 0;
        this.validationCursor += maxValidationsPerSweep;
        const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
        for (const { strategyKey, symbol, interval } of rotated) {
          if (validationAttempts >= maxValidationsPerSweep) break;
          const previous = latestByPair.get(`${strategyKey}:${symbol}:${interval}`);
          if (previous && previous >= validationCutoff) continue;
          const recentProvider = scope.recentRuns.find((run) => run.symbol === symbol)?.provider;
          const connection = connections.find((item) => item.provider === recentProvider) ?? connections[0]!;
          const provider = connection.provider === 'BINANCE_FUTURES'
            ? ExchangeProvider.BINANCE_FUTURES
            : ExchangeProvider.OKX_FUTURES;
          validationAttempts += 1;
          try {
            await this.quant.getRegimeIntelligence(symbol, provider, interval);
            await this.quant.getDiscoveredStrategies(userId, symbol, provider, interval, 500);
            await this.research.runFullQuantValidation({
              userId,
              provider,
              symbol,
              interval,
              lookbackCandles: 500,
              initialBalance: 10_000,
              strategyKey,
            });
            validations += 1;
          } catch (error) {
            unavailable += 1;
            this.logger.warn({ event: 'quant_research_pair_refresh_failed', userId, symbol, interval, strategyKey, error: error instanceof Error ? error.message : String(error) });
          }
        }
      } catch (error) {
        this.logger.warn({ event: 'quant_research_user_refresh_failed', userId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    this.logger.log({ event: 'quant_research_refresh_completed', users: userIds.length, symbols, validationAttempts, validations, unavailable });
  }
}
