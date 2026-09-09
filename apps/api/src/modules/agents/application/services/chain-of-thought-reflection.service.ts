import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIOrchestratorService } from '../../../ai/application/ai-orchestrator.service';

export interface ReflectionInput {
  symbol: string;
  candidateDecision: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  regime: string;
  anticipatorySignals?: {
    squeeze?: { active: boolean; breakoutProbability: number; breakoutBias: string };
    liquiditySweep?: { detected: boolean; direction: string | null; confidence: number };
    derivativesImbalance?: { squeezeProbability: number; squeezeDirection: string };
  };
  agentSummaries: Record<string, string>;
  recentLosses?: Array<{ symbol: string; reason: string; regime: string }>;
  scenarioBlueprint?: { primary: string; contingency: string; invalidation: string };
}

export interface ReflectionOutput {
  adjustedDecision: 'LONG' | 'SHORT' | 'WAIT';
  adjustedConfidence: number;
  reasoning: string;
  contrarianArguments: string[];
  trapProbability: number;  // 0-100
  overrideReason?: string;
}

@Injectable()
export class ChainOfThoughtReflectionService {
  private readonly logger = new Logger(ChainOfThoughtReflectionService.name);

  constructor(
    @Optional() private readonly aiOrchestrator?: AIOrchestratorService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async reflect(input: ReflectionInput, userId?: string): Promise<ReflectionOutput> {
    const enabled = this.configService?.get<boolean>('LLM_REFLECTION_ENABLED', true) ?? true;
    const timeoutMs = this.configService?.get<number>('LLM_REFLECTION_TIMEOUT_MS', 8000) ?? 8000;

    // If disabled or WAIT decision, skip reflection
    if (!enabled || input.candidateDecision === 'WAIT' || !this.aiOrchestrator) {
      return this.passthrough(input);
    }

    try {
      const prompt = this.buildPrompt(input);
      const model = this.configService?.get<string>('LLM_REFLECTION_MODEL', 'gemini-3.1-flash-lite') ?? 'gemini-3.1-flash-lite';
      const provider = this.configService?.get<string>('LLM_REFLECTION_PROVIDER') as any;

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
          temperature: 0.3,
          maxTokens: 800,
          correlationId: `reflection-${input.symbol}-${Date.now()}`,
        });

        clearTimeout(timer);
        const rawText = response.text ?? (response as any).response ?? (response.json ? JSON.stringify(response.json) : '');
        return this.parseResponse(rawText, input);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      this.logger.warn({
        event: 'reflection_failed',
        symbol: input.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.passthrough(input);
    }
  }

  private passthrough(input: ReflectionInput): ReflectionOutput {
    return {
      adjustedDecision: input.candidateDecision,
      adjustedConfidence: input.confidence,
      reasoning: 'Reflection skipped — passthrough mode.',
      contrarianArguments: [],
      trapProbability: 0,
    };
  }

  private systemPrompt(): string {
    return `You are a senior crypto trading risk analyst performing a final review of a trading decision.
Your job is to think critically and challenge the decision BEFORE it is executed.
You must be skeptical, contrarian, and thorough.

IMPORTANT: You are the last line of defense against bad trades. Be honest, not supportive.

Respond in JSON format with this exact structure:
{
  "adjustedDecision": "LONG" | "SHORT" | "WAIT",
  "adjustedConfidence": <number 0-100>,
  "reasoning": "<your chain-of-thought analysis>",
  "contrarianArguments": ["<reason 1 NOT to take this trade>", "<reason 2>", "<reason 3>"],
  "trapProbability": <number 0-100>,
  "overrideReason": "<if you changed the decision, explain why>" or null
}`;
  }

  private buildPrompt(input: ReflectionInput): string {
    const parts: string[] = [
      `## Trading Decision Under Review`,
      `- Symbol: ${input.symbol}`,
      `- Candidate Decision: ${input.candidateDecision}`,
      `- Confidence: ${input.confidence}%`,
      `- Market Regime: ${input.regime}`,
    ];

    if (input.anticipatorySignals) {
      parts.push(`\n## Anticipatory Signals`);
      if (input.anticipatorySignals.squeeze) {
        const s = input.anticipatorySignals.squeeze;
        parts.push(`- Squeeze: ${s.active ? 'ACTIVE' : 'Inactive'} (breakout prob: ${s.breakoutProbability}%, bias: ${s.breakoutBias})`);
      }
      if (input.anticipatorySignals.liquiditySweep) {
        const l = input.anticipatorySignals.liquiditySweep;
        parts.push(`- Liquidity Sweep: ${l.detected ? 'DETECTED' : 'None'} (direction: ${l.direction}, confidence: ${l.confidence}%)`);
      }
      if (input.anticipatorySignals.derivativesImbalance) {
        const d = input.anticipatorySignals.derivativesImbalance;
        parts.push(`- Derivatives: squeeze prob ${d.squeezeProbability}%, direction: ${d.squeezeDirection}`);
      }
    }

    parts.push(`\n## Agent Summaries`);
    for (const [agent, summary] of Object.entries(input.agentSummaries)) {
      parts.push(`- ${agent}: ${summary}`);
    }

    if (input.recentLosses && input.recentLosses.length > 0) {
      parts.push(`\n## Recent Losses (WARNING: Pattern may be repeating)`);
      for (const loss of input.recentLosses.slice(0, 5)) {
        parts.push(`- ${loss.symbol} in ${loss.regime}: ${loss.reason}`);
      }
    }

    if (input.scenarioBlueprint) {
      parts.push(`\n## Scenario Blueprint`);
      parts.push(`- Primary: ${input.scenarioBlueprint.primary}`);
      parts.push(`- Contingency: ${input.scenarioBlueprint.contingency}`);
      parts.push(`- Invalidation: ${input.scenarioBlueprint.invalidation}`);
    }

    parts.push(`\n## Your Task`);
    parts.push(`1. Analyze whether this ${input.candidateDecision} decision at ${input.confidence}% confidence is sound.`);
    parts.push(`2. Consider: Is this a bull trap / bear trap? Is the entry timing right or too late?`);
    parts.push(`3. Provide exactly 3 contrarian arguments against this trade.`);
    parts.push(`4. Estimate the probability this is a market trap (0-100).`);
    parts.push(`5. If trap probability > 70% or you see critical flaws, override to WAIT.`);
    parts.push(`6. If the trade is sound but confidence is too high, adjust confidence down.`);

    return parts.join('\n');
  }

  private parseResponse(raw: string, input: ReflectionInput): ReflectionOutput {
    try {
      // Try to parse JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.passthrough(input);

      const parsed = JSON.parse(jsonMatch[0]);

      const adjustedDecision = ['LONG', 'SHORT', 'WAIT'].includes(parsed.adjustedDecision)
        ? parsed.adjustedDecision
        : input.candidateDecision;

      const adjustedConfidence = typeof parsed.adjustedConfidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.adjustedConfidence)))
        : input.confidence;

      const trapProbability = typeof parsed.trapProbability === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.trapProbability)))
        : 0;

      const contrarianArguments = Array.isArray(parsed.contrarianArguments)
        ? parsed.contrarianArguments.filter((a: unknown) => typeof a === 'string').slice(0, 5)
        : [];

      return {
        adjustedDecision,
        adjustedConfidence,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided.',
        contrarianArguments,
        trapProbability,
        overrideReason: typeof parsed.overrideReason === 'string' ? parsed.overrideReason : undefined,
      };
    } catch {
      this.logger.warn({ event: 'reflection_parse_failed', raw: raw.slice(0, 200) });
      return this.passthrough(input);
    }
  }
}
