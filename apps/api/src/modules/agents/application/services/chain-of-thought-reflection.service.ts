import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIOrchestratorService } from '../../../ai/application/ai-orchestrator.service';
import { AnticipatoryMarketSnapshot, TradeThesis, ThesisReview, ThesisReviewSchema } from '@platform/shared';

export interface CriticInput {
  snapshot: AnticipatoryMarketSnapshot;
  thesis: TradeThesis;
}

@Injectable()
export class ChainOfThoughtReflectionService {
  private readonly logger = new Logger(ChainOfThoughtReflectionService.name);

  constructor(
    @Optional() private readonly aiOrchestrator?: AIOrchestratorService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async reflect(input: CriticInput, userId?: string): Promise<ThesisReview> {
    const enabled = this.configService?.get<boolean>('LLM_REFLECTION_ENABLED', true) ?? true;
    const timeoutMs = this.configService?.get<number>('LLM_REFLECTION_TIMEOUT_MS', 8000) ?? 8000;

    // If disabled or WAIT decision, skip reflection
    if (!enabled || input.thesis.direction === 'WAIT' || !this.aiOrchestrator) {
      return this.passthrough(input);
    }

    try {
      const prompt = this.buildPrompt(input);
      const model = this.configService?.get<string>('LLM_REFLECTION_MODEL', 'gemini-3.1-flash-lite') ?? 'gemini-3.1-flash-lite';
      const providerStr = this.configService?.get<string>('LLM_REFLECTION_PROVIDER');
      const provider = providerStr === 'OPENAI' || providerStr === 'ANTHROPIC' || providerStr === 'GEMINI' || providerStr === 'OLLAMA'
        ? providerStr
        : undefined;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.aiOrchestrator.execute({
          userId: userId ?? 'system-reflection',
          systemPrompt: this.systemPrompt(),
          userPrompt: prompt,
          model,
          provider,
          responseFormat: 'json',
          jsonSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['APPROVE', 'REDUCE_SIZE', 'REQUIRE_TRIGGER', 'CANCEL'] },
              sizeFactor: { type: 'number' },
              reasonCodes: { type: 'array', items: { type: 'string' } },
              evidenceRefs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    snapshotField: { type: 'string' },
                    source: { type: 'string' },
                    sourceTimestamp: { type: 'string' },
                    calculationVersion: { type: 'number' }
                  },
                  required: ['snapshotField', 'source', 'sourceTimestamp', 'calculationVersion']
                }
              },
              rationale: { type: 'string' }
            },
            required: ['action', 'reasonCodes', 'evidenceRefs', 'rationale']
          },
          temperature: 0.2,
          maxTokens: 800,
          correlationId: `reflection-${input.snapshot.symbol}-${Date.now()}`,
        });

        clearTimeout(timer);
        const rawText = response.text || (response.json ? JSON.stringify(response.json) : '');
        return this.parseResponse(rawText, input);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      this.logger.warn({
        event: 'reflection_failed',
        symbol: input.snapshot.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.passthrough(input);
    }
  }

  private passthrough(input: CriticInput): ThesisReview {
    return {
      action: 'APPROVE',
      reasonCodes: [],
      evidenceRefs: [],
      rationale: 'Reflection skipped — passthrough mode.',
    };
  }

  private systemPrompt(): string {
    return `You are a senior crypto trading risk analyst (Critic) reviewing a proposed TradeThesis.
Your job is to think critically and challenge the thesis BEFORE it is executed.
You must be skeptical, contrarian, and thorough.

CRUCIAL CONSTRAINT: You cannot reverse direction (e.g. LONG to SHORT). A contrary opinion becomes a REDUCE_SIZE, REQUIRE_TRIGGER, or CANCEL action.

Respond in JSON format matching this schema:
{
  "action": "APPROVE" | "REDUCE_SIZE" | "REQUIRE_TRIGGER" | "CANCEL",
  "sizeFactor": <number between 0 and 1, only if REDUCE_SIZE>,
  "reasonCodes": ["<code1>", "<code2>"],
  "evidenceRefs": [],
  "rationale": "<concise reasoning>"
}`;
  }

  private buildPrompt(input: CriticInput): string {
    return `## Snapshot Context
Symbol: ${input.snapshot.symbol}
Timeframe: ${input.snapshot.timeframe}

## Proposed Thesis
${JSON.stringify(input.thesis, null, 2)}

Analyze this thesis. Identify any traps, late entry, or invalidated setups.
If you reject, return CANCEL. If it needs confirmation, return REQUIRE_TRIGGER. If size should be reduced due to risk, return REDUCE_SIZE with sizeFactor.`;
  }

  private parseResponse(raw: string, input: CriticInput): ThesisReview {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          action: 'REQUIRE_TRIGGER',
          reasonCodes: ['CRITIC_NO_JSON'],
          evidenceRefs: [],
          rationale: 'Reflection failed to return JSON. Safely falling back to REQUIRE_TRIGGER.'
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Strip adjustedDecision if the model hallucinates it
      if ('adjustedDecision' in parsed) {
        delete parsed.adjustedDecision;
      }

      return ThesisReviewSchema.parse(parsed);
    } catch (err) {
      this.logger.warn({ event: 'reflection_parse_failed', raw: raw.slice(0, 200), error: err });
      return {
        action: 'REQUIRE_TRIGGER',
        reasonCodes: ['CRITIC_PARSE_FAILED'],
        evidenceRefs: [],
        rationale: 'Reflection failed to parse properly. Safely falling back to REQUIRE_TRIGGER.'
      };
    }
  }
}
