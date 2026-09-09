import { Injectable, Logger } from '@nestjs/common';
import {
  AnticipatoryMarketSnapshot,
  TradeThesis,
  TradeThesisSchema,
} from '@platform/shared';
import { AIOrchestratorService } from '../../../ai/application/ai-orchestrator.service';
import { DecisionService } from './decision.service';
import { TRADE_RESEARCHER_SYSTEM_PROMPT } from '../../domain/prompts/trade-researcher.prompt';
import { validateTradeThesis } from '../../domain/trade-thesis-validator';
import { PrismaService } from '../../../../database/prisma.service';

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
    try {
      // Prompt must contain ONLY the versioned snapshot and cohort summary (no raw price history, no user details).
      const cohortSummary = this.buildCohortSummary(snapshot);
      const userPrompt = JSON.stringify({
        snapshot,
        cohortSummary,
      });

      const response = await this.aiOrchestrator.execute({
        userId: context.userId,
        provider: context.provider as any,
        model: context.model,
        systemPrompt: TRADE_RESEARCHER_SYSTEM_PROMPT,
        userPrompt,
        responseFormat: 'json',
      });

      if (!response.json) {
        throw new Error('AI Provider returned empty JSON');
      }

      // Parse AI response through TradeThesisSchema
      const preferred = TradeThesisSchema.parse(response.json.preferred);
      const alternatives = Array.isArray(response.json.alternatives)
        ? response.json.alternatives.map((a: any) => TradeThesisSchema.parse(a))
        : [];

      // Validate references and basics
      const validation = validateTradeThesis(preferred, snapshot);
      if (!validation.valid) {
        throw new Error(
          `AI thesis failed validation: ${validation.reasons.join(', ')}`,
        );
      }

      // Enforce at most one thesis per direction
      const directions = new Set([preferred.direction, ...alternatives.map((a: TradeThesis) => a.direction)]);
      if (directions.size !== 1 + alternatives.length) {
         throw new Error('AI returned multiple theses for the same direction');
      }

      // Ensure decisionSource is correctly labeled if AI succeeded
      preferred.decisionSource = 'AI';
      alternatives.forEach((a: TradeThesis) => (a.decisionSource = 'AI'));

      // Persist model, provider, prompt version, config hash and parent snapshot ID
      await this.persistRun(context, response, startedAt, new Date(), true);

      return { preferred, alternatives };
    } catch (err: unknown) {
      this.logger.warn(
        `AI researcher failed, falling back to rules Decision adapter: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Persist failure
      await this.persistRun(context, null, startedAt, new Date(), false);
      return this.fallbackToRules(snapshot, context);
    }
  }

  private async persistRun(
    context: TradeResearcherContext,
    response: any,
    startedAt: Date,
    completedAt: Date,
    success: boolean,
  ): Promise<void> {
    try {
      await this.prisma.agentRun.create({
        data: {
          userId: context.userId,
          agentType: 'DECISION_SYNTHESIZER', // Fallback type since TRADE_RESEARCHER might not be in schema enum
          agentVersion: 1,
          invocationSource: 'INTERNAL_SERVICE',
          inputHash: context.configHash, // Persist config hash
          sanitizedInput: {},
          output: response?.json || {},
          promptId: 'trade-researcher',
          promptVersion: context.promptVersion, // Persist prompt version
          contextSnapshotId: context.parentSnapshotId, // Persist parent snapshot ID
          provider: response?.provider || context.provider || 'UNKNOWN', // Persist provider
          model: response?.model || context.model || 'UNKNOWN', // Persist model
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          inputTokens: response?.usage?.promptTokens || 0,
          outputTokens: response?.usage?.completionTokens || 0,
          status: success ? 'COMPLETED' : 'FAILED',
        },
      });
    } catch (err) {
      this.logger.error(`Failed to persist AgentRun for TradeResearcher: ${err}`);
    }
  }

  private async fallbackToRules(
    snapshot: AnticipatoryMarketSnapshot,
    context: TradeResearcherContext,
  ): Promise<TradeResearchResult> {
    const minimalInput = {
      symbol: snapshot.symbol,
      fusionOutput: {
        summary: 'Fallback',
        combinedAnalysis: {
           market: '', technical: '', news: '', sentiment: '', macro: '', onchain: ''
        },
        overallBias: 'NEUTRAL',
        confidence: 50,
        conflicts: [],
        dataQuality: 'GOOD',
        generatedAt: new Date().toISOString(),
      },
    };

    const rulesDecision = await this.decisionService.decideForUser(minimalInput as any, context.userId);

    const preferred: TradeThesis = {
      thesisVersion: 1,
      decisionSource: 'AI_WITH_RULES_FALLBACK',
      state: rulesDecision.decision === 'WAIT' ? 'WAIT' : 'PROBE_READY',
      direction: rulesDecision.decision,
      regime: rulesDecision.regime.type,
      transitionProbability: 0.1,
      setup: rulesDecision.decision === 'WAIT' ? 'NO_TRADE' : 'TREND_PULLBACK', // simplified fallback
      entryZone: rulesDecision.decision === 'WAIT' ? null : { lower: 0, upper: 0 },
      trigger: [],
      invalidation: rulesDecision.decision === 'WAIT' ? null : { price: 0, reason: 'Fallback' },
      stopLoss: rulesDecision.decision === 'WAIT' ? null : 0,
      targets: rulesDecision.decision === 'WAIT' ? [] : [{ price: 0, fraction: 1 }],
      expectedNetR: rulesDecision.decision === 'WAIT' ? null : 1,
      maximumChaseDistanceAtr: 1,
      confidence: rulesDecision.confidence,
      evidenceFor: [],
      evidenceAgainst: [],
      missingEvidence: [],
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(), // 4h
    };

    return {
      preferred,
      alternatives: [],
    };
  }

  private buildCohortSummary(snapshot: AnticipatoryMarketSnapshot): string {
    return `Cohort context for ${snapshot.symbol} at ${snapshot.timeframe}. Regime appears to be ${snapshot.structure.coverage === 'AVAILABLE' ? 'ACTIVE' : 'UNKNOWN'}.`;
  }
}
