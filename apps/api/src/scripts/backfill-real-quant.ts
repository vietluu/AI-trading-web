import "reflect-metadata";
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from "@nestjs/core";
import { resolve } from 'node:path';
import { ExchangeInterval, ExchangeProvider } from "../exchange/domain/exchange.types";
import { validateEnvironment } from '../config/environment';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { ResearchModule } from '../modules/research/research.module';
import { SessionModule } from '../session/session.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../database/prisma.service';
import { QuantIntelligenceService } from '../modules/research/application/quant-intelligence.service';
import { ResearchService } from '../modules/research/application/research.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: [resolve(__dirname, '../../../../.env'), resolve(__dirname, '../../.env')],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ connection: { url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379' } }),
    }),
    DatabaseModule,
    RedisModule,
    SessionModule,
    AuditModule,
    ResearchModule,
  ],
})
class QuantBackfillCliModule {}

async function main(): Promise<void> {
  process.env.REFLECTION_ENABLED = "false";
  process.env.LIVE_POSITION_SYNC_ENABLED = "false";
  process.env.CLI_DISABLE_SCHEDULERS = "true";
  const userId = process.argv[2];
  const requestedSymbol = process.argv[3]?.trim().toUpperCase().replace(/[/_]/g, "-");
  const requestedTimeframe = process.argv[4]?.trim();
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("Usage: node dist/scripts/backfill-real-quant.js <user-uuid> [symbol] [timeframe]");
  }
  const app = await NestFactory.createApplicationContext(QuantBackfillCliModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const quant = app.get(QuantIntelligenceService);
    const research = app.get(ResearchService);
    const [setting, connections, recentRuns, selected] = await Promise.all([
      prisma.userSetting.findUnique({ where: { userId } }),
      prisma.exchangeConnection.findMany({
        where: { userId, isEnabled: true, isVerified: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.pipelineRun.findMany({
        where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) } },
        select: { symbol: true, provider: true, timeframe: true },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      quant.getSelectedResearchSymbols(userId),
    ]);
    const symbols = requestedSymbol
      ? (/^[A-Z0-9]+-[A-Z0-9]+$/.test(requestedSymbol) ? [requestedSymbol] : [])
      : selected.symbols;
    const validIntervals = new Set<string>(Object.values(ExchangeInterval));
    const timeframes = [
      ...new Set(
        (requestedTimeframe
          ? [requestedTimeframe]
          : [...(setting?.preferredTimeframes ?? []), ...recentRuns.map((run) => run.timeframe ?? "")])
          .filter((value) => validIntervals.has(value)),
      ),
    ] as ExchangeInterval[];
    if (!symbols.length || !timeframes.length) {
      process.stdout.write(`${JSON.stringify({
        status: !symbols.length ? "NO_SYMBOLS_SELECTED" : "NO_TIMEFRAMES_SELECTED",
        symbols,
        timeframes,
        sources: selected,
      }, null, 2)}\n`);
      return;
    }
    if (!connections.length) {
      process.stdout.write(`${JSON.stringify({ status: "NO_VERIFIED_EXCHANGE_CONNECTION", symbols, timeframes }, null, 2)}\n`);
      return;
    }
    const preferredConnection = connections.find((item) => item.provider === setting?.preferredExchange) ?? connections[0]!;
    const connectionForSymbol = (symbol: string) => {
      const pipelineProvider = recentRuns.find((run) => run.symbol === symbol)?.provider;
      return connections.find((item) => item.provider === pipelineProvider) ?? preferredConnection;
    };

    const scorecard = await quant.getDecisionScorecard(userId);
    const factors = await quant.getFactorEvaluations(userId);
    const weights = await quant.getOptimizedWeights(userId, "AGENT");
    const thresholds = await quant.getOptimizedThresholds(userId);
    const results = [];
    const errors = [];
    for (const symbol of symbols) {
      const connection = connectionForSymbol(symbol);
      const provider = connection.provider === "BINANCE_FUTURES"
        ? ExchangeProvider.BINANCE_FUTURES
        : ExchangeProvider.OKX_FUTURES;
      const hypothesis = await quant.generateHypothesis(userId, "FACTOR_COMBINATION", symbol);
      const autoBenchmarks = await quant.getAutoBenchmarks(userId, "HYBRID_QUANT", symbol);
      for (const interval of timeframes) {
        const common = { userId, provider, symbol, interval, lookbackCandles: 500, initialBalance: 10_000 };
        try {
          const existingValidation = await prisma.researchValidationRun.findFirst({
            where: {
              userId,
              symbol,
              interval,
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
            },
            orderBy: { createdAt: 'desc' },
          });
          const regime = await quant.getRegimeIntelligence(symbol, provider, interval);
          const strategies = await quant.getDiscoveredStrategies(userId, symbol, provider, interval, 500);
          const benchmark = await research.runBenchmarkAnalysis({ ...common, leverage: 2, riskPerTrade: 0.01, riskRewardRatio: 2 });
          const validationRunId = existingValidation?.id ?? (await research.runFullQuantValidation(common)).validationRunId;
          const sensitivity = await research.runSensitivityAnalysis({ ...common, parameterName: "confidenceFloor" });
          const simulation = await quant.runSimulation(userId, {
            name: `${symbol} ${interval} real-candle HYBRID_QUANT validation`,
            experimentType: "STRATEGY",
            symbol,
            provider,
            interval,
            lookbackCandles: 500,
            config: { strategyName: "HYBRID_QUANT", confidenceThreshold: 65, atrMultiplier: 1.8 },
          });
          results.push({
            symbol,
            provider,
            interval,
            hypothesisStatus: hypothesis.status,
            regime: regime.detectedRegime,
            strategyCount: strategies.length,
            autoBenchmarkCount: autoBenchmarks.length,
            topBenchmark: benchmark.leaderboard[0],
            validationRunId,
            validationReused: Boolean(existingValidation),
            sensitivityOptimal: sensitivity.optimalValue,
            simulationPassed: simulation.passedCriteria,
          });
        } catch (error) {
          errors.push({ symbol, provider, interval, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    const report = await quant.getReport("DAILY", userId);
    process.stdout.write(`${JSON.stringify({
      status: errors.length ? (results.length ? "PARTIAL" : "FAILED") : "COMPLETED",
      symbols,
      timeframes,
      scorecard,
      factorCount: factors.length,
      weights,
      thresholds,
      reportId: report.id,
      results,
      errors,
    }, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
