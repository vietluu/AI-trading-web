import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  AnticipatoryMarketSnapshot,
  TradeThesis,
  TradeThesisSchema,
  type ThesisReview, type ThesisValidationResult,
} from '@platform/shared';
import type { AIProviderType, AIResponseDto } from '@platform/shared';
import { AIOrchestratorService } from '../../../ai/application/ai-orchestrator.service';
import { DecisionService } from './decision.service';
import { TRADE_RESEARCHER_SYSTEM_PROMPT, TRADE_THESIS_JSON_SCHEMA } from '../../domain/prompts/trade-researcher.prompt';
import { validateTradeThesis } from '../../domain/trade-thesis-validator';
import { PrismaService } from '../../../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { ExchangeProvider } from '../../../../exchange/domain/exchange.types';

function asAiProvider(value: string | undefined): AIProviderType | undefined {
  return value === 'OPENAI' || value === 'ANTHROPIC' || value === 'GEMINI' || value === 'OLLAMA'
    ? value
    : undefined;
}

export interface TradeResearcherContext {
  userId: string;
  provider?: string;
  model?: string;
  configHash: string;
  parentSnapshotId: string;
  promptVersion: number;
}

export interface TradeResearchResult {
  preferred: TradeThesis;
  alternatives: TradeThesis[];
  researchRunId?: string;
  contextSnapshotId?: string;
}

@Injectable()
export class TradeResearcherService {
  private readonly logger = new Logger(TradeResearcherService.name);

  constructor(
    private readonly aiOrchestrator: AIOrchestratorService,
    private readonly decisionService: DecisionService,
    private readonly prisma: PrismaService,
  ) {}

  public async research(
    snapshot: AnticipatoryMarketSnapshot,
    context: TradeResearcherContext,
  ): Promise<TradeResearchResult> {
    const startedAt = new Date();
    const storedSnapshot = await this.prisma.agentContextSnapshot.create({ data: {
      userId: context.userId, symbol: snapshot.symbol, provider: snapshot.provider, timeframe: snapshot.timeframe,
      sourceDataCutoff: new Date(snapshot.sourceDataCutoff), schemaVersion: snapshot.schemaVersion,
      builderVersion: String(snapshot.calculationVersion),
      contextHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
      serializedContext: snapshot,
    } });
    let response: AIResponseDto | null = null;
    let result: TradeResearchResult;
    let failure: string | undefined;
    try {
      // Prompt must contain ONLY the versioned snapshot and cohort summary (no raw price history, no user details).
      const cohortSummary = this.buildCohortSummary(snapshot);
      const userPrompt = JSON.stringify({
        snapshot,
        cohortSummary,
      });

      response = await this.aiOrchestrator.execute({
        userId: context.userId,
        provider: asAiProvider(context.provider),
        model: context.model,
        systemPrompt: TRADE_RESEARCHER_SYSTEM_PROMPT,
        userPrompt,
        responseFormat: 'json',
        jsonSchema: TRADE_THESIS_JSON_SCHEMA,
      });

      if (!response.json) {
        throw new Error('AI Provider returned empty JSON');
      }

      // Parse AI response through TradeThesisSchema
      const preferred = TradeThesisSchema.parse(response.json.preferred);
      const alternatives = Array.isArray(response.json.alternatives)
        ? response.json.alternatives.map((alternative: unknown) => TradeThesisSchema.parse(alternative))
        : [];

      // Validate references and basics
      const validation = validateTradeThesis(preferred, snapshot, { now: new Date() });
      if (!validation.valid) {
        throw new Error(
          `AI thesis failed validation: ${validation.reasons.join(', ')}`,
        );
      }
      for (const alt of alternatives) {
        const altValidation = validateTradeThesis(alt, snapshot, { now: new Date() });
        if (!altValidation.valid) {
          throw new Error(`AI alternative thesis failed validation: ${altValidation.reasons.join(', ')}`);
        }
      }

      // Enforce at most one thesis per direction
      const directions = new Set([preferred.direction, ...alternatives.map((a: TradeThesis) => a.direction)]);
      if (directions.size !== 1 + alternatives.length) {
         throw new Error('AI returned multiple theses for the same direction');
      }

      // Ensure decisionSource is correctly labeled if AI succeeded
      preferred.decisionSource = 'AI';
      alternatives.forEach((a: TradeThesis) => (a.decisionSource = 'AI'));

      result = { preferred, alternatives };
    } catch (err: unknown) {
      failure = err instanceof Error ? err.message : String(err);
      this.logger.warn({ event: 'trade_researcher_rules_fallback', reason: failure });
      result = await this.fallbackToRules(snapshot, context);
    }
    // Audit errors propagate: execution must not outlive its pre-outcome evidence.
    const row = await this.prisma.agentRun.create({ data: {
      userId: context.userId, agentType: 'DECISION_SYNTHESIZER', agentVersion: 1,
      invocationSource: 'INTERNAL_SERVICE', inputHash: context.configHash,
      sanitizedInput: { configHash: context.configHash, sourceDataCutoff: snapshot.sourceDataCutoff },
      output: result as unknown as Prisma.InputJsonValue,
      contextSnapshotId: storedSnapshot.id, correlationId: context.parentSnapshotId,
      promptId: 'trade-researcher', promptVersion: context.promptVersion,
      provider: response?.provider ?? context.provider ?? 'UNKNOWN', model: response?.model ?? context.model ?? 'UNKNOWN',
      startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(),
      inputTokens: response?.usage?.promptTokens ?? 0, outputTokens: response?.usage?.completionTokens ?? 0,
      status: failure ? 'FAILED' : 'COMPLETED', ...(failure ? { failureCode: 'RULES_FALLBACK', safeFailureMessage: failure.slice(0, 1000) } : {}),
    } });
    return { ...result, researchRunId: row.id, contextSnapshotId: storedSnapshot.id };
  }

  async persistReview(input: {
    context: TradeResearcherContext; research: TradeResearchResult;
    review: ThesisReview; appliedThesis: TradeThesis; validation: ThesisValidationResult;
  }): Promise<string> {
    if (!input.research.researchRunId || !input.research.contextSnapshotId) throw new Error('THESIS_AUDIT_PARENT_REQUIRED');
    const row = await this.prisma.agentRun.create({ data: {
      userId: input.context.userId, agentType: 'DECISION_SYNTHESIZER', invocationSource: 'INTERNAL_SERVICE',
      inputHash: input.context.configHash, contextSnapshotId: input.research.contextSnapshotId,
      parentRunId: input.research.researchRunId, correlationId: input.context.parentSnapshotId,
      promptId: 'thesis-critic', promptVersion: 1, status: 'COMPLETED',
      output: { review: input.review, appliedThesis: input.appliedThesis, validation: input.validation },
      startedAt: new Date(), completedAt: new Date(),
    } });
    return row.id;
  }

  private async fallbackToRules(
    snapshot: AnticipatoryMarketSnapshot,
    context: TradeResearcherContext,
  ): Promise<TradeResearchResult> {
    const rulesDecision = await this.decisionService.run({
      userId: context.userId,
      invocationSource: 'INTERNAL_SERVICE',
      correlationId: context.parentSnapshotId,
      input: {
        symbol: snapshot.symbol,
        provider: snapshot.provider as ExchangeProvider,
        interval: snapshot.timeframe as '1m' | '5m' | '15m' | '1h',
        lookbackCandles: 150,
        lookbackHours: 6,
        maxItems: 20,
      }
    });

    let entryZone = null;
    let stopLoss = null;
    let invalidation = null;
    let targets: { price: number; fraction: number }[] = [];
    let expectedNetR = null;

    if (rulesDecision.decision !== 'WAIT' && snapshot.execution.coverage === 'AVAILABLE' && snapshot.volatility.coverage === 'AVAILABLE') {
      const currentPrice = snapshot.execution.currentPrice;
      const atr = snapshot.volatility.atr;
      
      if (rulesDecision.decision === 'LONG') {
        entryZone = { lower: currentPrice - atr, upper: currentPrice };
        stopLoss = currentPrice - 2 * atr;
        invalidation = { price: stopLoss, reason: 'Fallback ATR stop' };
        targets = [{ price: currentPrice + 4 * atr, fraction: 1 }];
        expectedNetR = 1.5;
      } else {
        entryZone = { lower: currentPrice, upper: currentPrice + atr };
        stopLoss = currentPrice + 2 * atr;
        invalidation = { price: stopLoss, reason: 'Fallback ATR stop' };
        targets = [{ price: currentPrice - 4 * atr, fraction: 1 }];
        expectedNetR = 1.5;
      }
    }

    const preferred: TradeThesis = {
      thesisVersion: 1,
      decisionSource: 'AI_WITH_RULES_FALLBACK',
      state: rulesDecision.decision === 'WAIT' ? 'WAIT' : 'PROBE_READY',
      direction: rulesDecision.decision,
      regime: rulesDecision.regime.type,
      transitionProbability: 0.1,
      setup: rulesDecision.decision === 'WAIT' ? 'NO_TRADE' : 'TREND_PULLBACK', // simplified fallback
      entryZone,
      trigger: snapshot.execution.coverage === 'AVAILABLE' ? [{ type: rulesDecision.decision === 'SHORT' ? 'PRICE_BELOW' : 'PRICE_ABOVE', price: snapshot.execution.currentPrice, description: 'Rules baseline price confirmation' }] : [],
      invalidation,
      stopLoss,
      targets,
      expectedNetR,
      maximumChaseDistanceAtr: 1,
      confidence: rulesDecision.confidence,
      evidenceFor: snapshot.structure.coverage === 'AVAILABLE' ? snapshot.structure.evidence : [],
      evidenceAgainst: [],
      missingEvidence: [],
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(), // 4h
    };

    const validation = validateTradeThesis(preferred, snapshot, { now: new Date() });
    if (!validation.valid) {
      // Fallback geometry was invalid, force WAIT
      preferred.direction = 'WAIT';
      preferred.setup = 'NO_TRADE';
      preferred.state = 'WAIT';
      preferred.entryZone = null;
      preferred.invalidation = null;
      preferred.stopLoss = null;
      preferred.targets = [];
      preferred.expectedNetR = null;
    }

    return {
      preferred,
      alternatives: [],
    };
  }

  private buildCohortSummary(snapshot: AnticipatoryMarketSnapshot): string {
    return `Cohort context for ${snapshot.symbol} at ${snapshot.timeframe}. Regime appears to be ${snapshot.structure.coverage === 'AVAILABLE' ? 'ACTIVE' : 'UNKNOWN'}.`;
  }
}
