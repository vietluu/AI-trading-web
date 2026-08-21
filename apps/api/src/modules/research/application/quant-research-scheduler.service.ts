import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedTaskLockService } from '../../../redis/distributed-task-lock.service';
import { QuantIntelligenceService } from './quant-intelligence.service';
import { ResearchService } from './research.service';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';

const REFRESH_INTERVAL_MS = 5 * 60_000;
const KNOWN_STRATEGIES = ['ai-core', 'trend', 'mean-reversion', 'breakout', 'momentum-scalp'] as const;
type ValidationCandidate = { strategyKey: string; symbol: string; interval: ExchangeInterval; provider: ExchangeProvider; previous?: Date; priority?: number };

function rotatingHash(value: string, bucket: number): number {
  let hash = bucket | 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function scheduledStrategyKeys(schedules: Array<{ strategyIds: string[] }>): string[] {
  const requested = new Set(schedules.flatMap((item) => item.strategyIds));
  requested.add('ai-core');
  if (requested.has('breakout')) requested.add('momentum-scalp');
  return KNOWN_STRATEGIES.filter((key) => requested.has(key));
}

export function prioritizeValidationCandidates(candidates: ValidationCandidate[], now = new Date()): ValidationCandidate[] {
  const bucket = Math.floor(now.getTime() / REFRESH_INTERVAL_MS);
  return [...candidates].sort((left, right) => {
    const priorityOrder = (left.priority ?? 1) - (right.priority ?? 1);
    if (priorityOrder !== 0) return priorityOrder;
    const ageOrder = (left.previous?.getTime() ?? 0) - (right.previous?.getTime() ?? 0);
    if (ageOrder !== 0) return ageOrder;
    const leftKey = `${left.strategyKey}:${left.symbol}:${left.interval}:${left.provider}`;
    const rightKey = `${right.strategyKey}:${right.symbol}:${right.interval}:${right.provider}`;
    return rotatingHash(leftKey, bucket) - rotatingHash(rightKey, bucket);
  });
}

@Injectable()
export class QuantResearchSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QuantResearchSchedulerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quant: QuantIntelligenceService,
    private readonly research: ResearchService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => void this.runSweepSafely(), REFRESH_INTERVAL_MS);
    this.timer.unref();
    void this.runSweepSafely();
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

  private async runSweepSafely(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error({ event: 'quant_research_sweep_failed', error: error instanceof Error ? error.message : String(error) });
    }
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
    const validationCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const maxValidationsPerUser = 8;
    const maxAttemptsPerUser = 24;
    for (const userId of userIds) {
      try {
        const result = await this.quant.generateSelectedHypotheses(userId);
        symbols += result.symbols.length;
        unavailable += result.hypotheses.filter((item) => item.status === 'DATA_UNAVAILABLE').length;
        const scope = await this.quant.getSelectedResearchScope(userId);
        if (!scope.symbols.length || !scope.timeframes.length) continue;
        const [connections, schedules, portfolioStrategies] = await Promise.all([
          this.prisma.exchangeConnection.findMany({
            where: { userId, isEnabled: true, isVerified: true },
            orderBy: { createdAt: 'asc' },
          }),
          this.prisma.pipelineSchedule.findMany({
            where: { userId, enabled: true },
            select: { strategyIds: true },
          }),
          this.prisma.portfolioStrategy.findMany({
            where: { userId, status: 'ACTIVE' },
            select: { key: true, symbols: true },
          }),
        ]);
        if (!connections.length) continue;
        const latestRows = await this.prisma.researchValidationRun.findMany({
          where: { userId, symbol: { in: scope.symbols }, interval: { in: scope.timeframes } },
          orderBy: { createdAt: 'desc' },
        });
        const latestByPair = new Map<string, Date>();
        for (const row of latestRows) {
          const key = `${row.strategyKey}:${row.symbol}:${row.interval}:${row.provider}`;
          if (!latestByPair.has(key)) latestByPair.set(key, row.createdAt);
        }
        const strategyKeys = scheduledStrategyKeys(schedules);
        const portfolioScope = new Set(
          portfolioStrategies.flatMap((strategy) =>
            strategy.symbols.map((symbol) => `${strategy.key}:${symbol}`),
          ),
        );
        const candidates = prioritizeValidationCandidates(strategyKeys.flatMap((strategyKey) =>
          scope.symbols.flatMap((symbol) => scope.timeframes.map((interval) => {
            const typedInterval = interval;
            const recentProvider = scope.recentRuns.find((run) => run.symbol === symbol)?.provider;
            const connection = connections.find((item) => item.provider === recentProvider) ?? connections[0]!;
            const provider = connection.provider === 'BINANCE_FUTURES'
              ? ExchangeProvider.BINANCE_FUTURES
              : ExchangeProvider.OKX_FUTURES;
            return {
              strategyKey,
              symbol,
              interval: typedInterval,
              provider,
              previous: latestByPair.get(`${strategyKey}:${symbol}:${typedInterval}:${provider}`),
              priority: portfolioScope.has(`${strategyKey}:${symbol}`) ? 0 : 1,
            };
          }))));
        const staleOrMissing = candidates.filter((candidate) => !candidate.previous || candidate.previous < validationCutoff);
        let userAttempts = 0;
        let userValidations = 0;
        for (const { strategyKey, symbol, interval, provider, previous } of staleOrMissing) {
          if (userValidations >= maxValidationsPerUser || userAttempts >= maxAttemptsPerUser) break;
          if (previous && previous >= validationCutoff) continue;
          userAttempts += 1;
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
            userValidations += 1;
          } catch (error) {
            unavailable += 1;
            this.logger.warn({ event: 'quant_research_pair_refresh_failed', userId, symbol, interval, strategyKey, error: error instanceof Error ? error.message : String(error) });
          }
        }
        await this.quant.refreshRecommendations(userId);
        this.logger.log({
          event: 'quant_research_coverage', userId, pairs: candidates.length,
          fresh: candidates.length - staleOrMissing.length,
          stale: staleOrMissing.filter((item) => item.previous).length,
          missing: staleOrMissing.filter((item) => !item.previous).length,
          attempts: userAttempts, validations: userValidations,
        });
      } catch (error) {
        this.logger.warn({ event: 'quant_research_user_refresh_failed', userId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    this.logger.log({ event: 'quant_research_refresh_completed', users: userIds.length, symbols, validations, unavailable });
  }
}
