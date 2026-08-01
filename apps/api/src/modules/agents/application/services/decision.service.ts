import { Injectable, Logger } from '@nestjs/common';
import {
  DecisionInputSchema,
  DecisionOutputSchema,
  DecisionRunInputSchema,
  type AgentDataQuality,
  type DecisionInput,
  type DecisionOutput,
  type DecisionRunInput,
  type FusionInput,
  type MarketRegime,
} from '@platform/shared';
import { AgentInvocationSource } from '../../domain/enums';
import { FusionService } from './fusion.service';

type AnalystName = keyof FusionInput;
type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
type ConflictLevel = DecisionOutput['conflictLevel'];
type Weighting = DecisionOutput['weighting'];

const BASE_WEIGHTS: Weighting = {
  market: 20,
  technical: 25,
  news: 15,
  sentiment: 15,
  macro: 15,
  onchain: 10,
};

const QUALITY_FACTOR: Record<AgentDataQuality, number> = {
  GOOD: 1,
  PARTIAL: 0.7,
  INSUFFICIENT: 0.3,
};

const REGIME_FACTOR: Record<MarketRegime['type'], number> = {
  TRENDING: 1.05,
  RANGING: 0.95,
  HIGH_VOLATILITY: 0.9,
};

export interface RunDecisionOptions {
  input: DecisionRunInput;
  userId?: string;
  sessionId?: string;
  invocationSource: AgentInvocationSource;
  correlationId?: string;
}

@Injectable()
export class DecisionService {
  private readonly logger = new Logger(DecisionService.name);

  constructor(private readonly fusionService: FusionService) {}

  public async run(options: RunDecisionOptions): Promise<DecisionOutput> {
    const input = DecisionRunInputSchema.parse(options.input);
    const result = await this.fusionService.runDetailed({ ...options, input });
    return this.decide({
      symbol: input.symbol,
      fusionOutput: result.fusionOutput,
      ...result.analyses,
    });
  }

  public decide(rawInput: DecisionInput): DecisionOutput {
    const input = DecisionInputSchema.parse(rawInput);
    const names = Object.keys(BASE_WEIGHTS) as AnalystName[];
    const regime = this.detectRegime(input);
    const weighting = this.dynamicWeights(regime.type);
    const active = names.filter((name) => {
      const output = input[name];
      return output !== undefined && output.dataQuality !== 'INSUFFICIENT';
    });
    const votes = new Map<AnalystName, Bias>(
      active.map((name) => [name, this.bias(name, input[name] as FusionInput[AnalystName])]),
    );
    const activeWeight = active.reduce((sum, name) => sum + weighting[name], 0);
    const voteWeight = (bias: Bias) =>
      active.reduce(
        (sum, name) => sum + (votes.get(name) === bias ? weighting[name] : 0),
        0,
      );
    const bullishWeight = voteWeight('BULLISH');
    const bearishWeight = voteWeight('BEARISH');
    const neutralWeight = voteWeight('NEUTRAL');
    const bullishCount = active.filter((name) => votes.get(name) === 'BULLISH').length;
    const bearishCount = active.filter((name) => votes.get(name) === 'BEARISH').length;
    const rawDirectionalBias = activeWeight
      ? ((bullishWeight - bearishWeight) / activeWeight) * 100
      : 0;
    const overrides: string[] = [];
    const newsShock = this.newsShock(input, overrides);
    const directionalBias = this.clamp(rawDirectionalBias + newsShock, -100, 100);
    const conflictLevel = this.conflictLevel(votes, rawDirectionalBias);

    let candidate: DecisionOutput['decision'] = 'WAIT';
    if (directionalBias >= 20 && bullishCount > bearishCount) candidate = 'LONG';
    if (directionalBias <= -20 && bearishCount > bullishCount) candidate = 'SHORT';

    if (input.news?.impact.level === 'HIGH' && input.news.impact.direction === 'NEGATIVE') {
      candidate = rawDirectionalBias <= 10 ? 'SHORT' : 'WAIT';
      overrides.push(
        candidate === 'SHORT'
          ? 'High-impact negative news overrode the normal weighted candidate toward SHORT.'
          : 'High-impact negative news conflicted with bullish evidence and forced WAIT.',
      );
    } else if (
      input.news?.impact.level === 'HIGH' &&
      input.news.impact.direction === 'POSITIVE' &&
      directionalBias >= 20 &&
      bullishCount >= bearishCount
    ) {
      candidate = 'LONG';
      overrides.push('High-impact positive news increased the bias toward LONG.');
    }

    const alignedCount =
      candidate === 'LONG'
        ? bullishCount
        : candidate === 'SHORT'
          ? bearishCount
          : Math.max(bullishCount, bearishCount, active.length - bullishCount - bearishCount);
    const agreementScore = active.length
      ? Math.round((alignedCount / active.length) * 100)
      : 0;
    const alignedWeight =
      candidate === 'LONG'
        ? bullishWeight
        : candidate === 'SHORT'
          ? bearishWeight
          : Math.max(bullishWeight, bearishWeight, neutralWeight);
    const baseScore = activeWeight ? (alignedWeight / activeWeight) * 100 : 0;
    const agreementFactor = this.agreementFactor(candidate, alignedCount, active.length);
    const dataQuality = this.dataQuality(input, active);
    const { factor: volatilityFactor, adjustment: volatilityAdjustment, extreme } =
      this.volatilityFilter(input);
    if (volatilityAdjustment < 0) {
      overrides.push(`High volatility reduced confidence by ${Math.abs(volatilityAdjustment)}%.`);
    }
    if (extreme) overrides.push('Extreme volatility forced WAIT.');

    const conflictFactor = conflictLevel === 'MEDIUM' ? 0.85 : 1;
    if (conflictLevel === 'MEDIUM') {
      overrides.push('Medium signal conflict reduced calibrated confidence by 15%.');
    }
    if (conflictLevel === 'HIGH') overrides.push('Strong signal conflict forced WAIT.');

    const confidence = Math.round(
      this.clamp(
        baseScore *
          agreementFactor *
          QUALITY_FACTOR[dataQuality] *
          volatilityFactor *
          REGIME_FACTOR[regime.type] *
          conflictFactor *
          (active.length / names.length),
        0,
        100,
      ),
    );
    const decision: DecisionOutput['decision'] =
      dataQuality === 'INSUFFICIENT' ||
      conflictLevel === 'HIGH' ||
      extreme ||
      confidence < 60
        ? 'WAIT'
        : candidate;
    if (confidence < 60) overrides.push('Calibrated confidence below 60 forced WAIT.');
    if (dataQuality === 'INSUFFICIENT') overrides.push('Insufficient data forced WAIT.');

    const signals = this.signals(input, votes, weighting);
    const risks = this.risks(input, votes, dataQuality, conflictLevel);
    const weightedBias =
      directionalBias > 0 ? 'bullish' : directionalBias < 0 ? 'bearish' : 'neutral';
    const output = DecisionOutputSchema.parse({
      decision,
      confidence,
      reasoning: `${active.length} of 6 analysts supplied usable data. The ${regime.type.toLowerCase().replace('_', ' ')} regime produced a normalized ${weightedBias} bias of ${Math.round(directionalBias)}, ${agreementScore}% analyst agreement, and ${Math.round(baseScore)}% weighted alignment. Calibrated confidence is ${confidence}% with ${dataQuality} data and ${conflictLevel} conflict.`,
      signals,
      risks,
      agreementScore,
      dataQuality,
      regime,
      weighting,
      overrides: [...new Set(overrides)],
      volatilityAdjustment,
      conflictLevel,
      generatedAt: new Date().toISOString(),
    });

    this.logger.log({
      event: 'decision_consensus_calculated',
      symbol: input.symbol,
      decision: output.decision,
      regime: regime.type,
      weighting,
      overrides: output.overrides,
      conflicts: input.fusionOutput.conflicts,
      conflictLevel,
      confidenceCalculation: {
        baseScore: Math.round(baseScore * 100) / 100,
        agreementFactor,
        dataQualityFactor: QUALITY_FACTOR[dataQuality],
        volatilityFactor,
        regimeFactor: REGIME_FACTOR[regime.type],
        conflictFactor,
        activeAgentFactor: active.length / names.length,
        finalConfidence: confidence,
      },
    });
    return output;
  }

  private detectRegime(input: DecisionInput): MarketRegime {
    const volatilityEvidence = [
      input.market?.volatility.atr,
      ...(input.market?.anomalies ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    if (
      input.market?.volatility.level === 'HIGH' ||
      /high atr|extreme atr|large swings?|volatility spike/.test(volatilityEvidence)
    ) return { type: 'HIGH_VOLATILITY' };
    if (input.market?.volatility.level === 'LOW') return { type: 'RANGING' };
    if (
      input.market?.trend.strength === 'STRONG' ||
      input.technical?.trend.strength === 'STRONG'
    ) return { type: 'TRENDING' };
    return { type: 'RANGING' };
  }

  private dynamicWeights(regime: MarketRegime['type']): Weighting {
    const weights = { ...BASE_WEIGHTS };
    if (regime === 'TRENDING') {
      weights.technical += 5;
      weights.news -= 5;
    } else if (regime === 'HIGH_VOLATILITY') {
      weights.market += 5;
      weights.sentiment += 5;
      weights.technical -= 5;
    } else {
      weights.technical += 5;
      weights.market -= 5;
    }
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    const normalized = {} as Weighting;
    const names = Object.keys(weights) as AnalystName[];
    names.forEach((name) => {
      normalized[name] = Math.round((weights[name] / total) * 10_000) / 100;
    });
    const normalizedTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
    normalized.onchain = Math.round((normalized.onchain + 100 - normalizedTotal) * 100) / 100;
    return normalized;
  }

  private newsShock(input: DecisionInput, overrides: string[]): number {
    if (input.news?.impact.level !== 'HIGH') return 0;
    if (input.news.impact.direction === 'NEGATIVE') {
      overrides.push('Applied a -20 directional news-shock adjustment.');
      return -20;
    }
    if (input.news.impact.direction === 'POSITIVE') {
      overrides.push('Applied a +10 directional news-shock adjustment.');
      return 10;
    }
    return 0;
  }

  private volatilityFilter(input: DecisionInput): {
    factor: number;
    adjustment: number;
    extreme: boolean;
  } {
    const evidence = [
      input.market?.volatility.atr,
      ...(input.market?.anomalies ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    const high =
      input.market?.volatility.level === 'HIGH' ||
      /high atr|extreme atr|large swings?|volatility spike/.test(evidence);
    if (!high) return { factor: 1, adjustment: 0, extreme: false };
    const extreme = /extreme|liquidation cascade|dislocation|violent|flash crash|parabolic spike/.test(evidence);
    return extreme
      ? { factor: 0.7, adjustment: -30, extreme: true }
      : { factor: 0.8, adjustment: -20, extreme: false };
  }

  private agreementFactor(
    candidate: DecisionOutput['decision'],
    aligned: number,
    active: number,
  ): number {
    if (active === 0 || candidate === 'WAIT') return 0.3;
    const ratio = aligned / active;
    if (ratio === 1) return 1;
    return ratio >= 0.5 ? ratio : 0.3;
  }

  private conflictLevel(votes: Map<AnalystName, Bias>, directionalBias: number): ConflictLevel {
    const opposing = (left: AnalystName, right: AnalystName) => {
      const first = votes.get(left);
      const second = votes.get(right);
      return (
        (first === 'BULLISH' && second === 'BEARISH') ||
        (first === 'BEARISH' && second === 'BULLISH')
      );
    };
    const namedConflicts = Number(opposing('technical', 'sentiment')) + Number(opposing('market', 'news'));
    const values = [...votes.values()];
    const hasBothDirections = values.includes('BULLISH') && values.includes('BEARISH');
    if (namedConflicts >= 2 || (hasBothDirections && Math.abs(directionalBias) < 20)) return 'HIGH';
    if (namedConflicts === 1 || hasBothDirections) return 'MEDIUM';
    return 'LOW';
  }

  private dataQuality(input: DecisionInput, active: AnalystName[]): AgentDataQuality {
    if (input.fusionOutput.dataQuality === 'INSUFFICIENT' || active.length < 3) {
      return 'INSUFFICIENT';
    }
    if (
      input.fusionOutput.dataQuality === 'GOOD' &&
      active.length === 6 &&
      active.every((name) => input[name]?.dataQuality === 'GOOD')
    ) return 'GOOD';
    return 'PARTIAL';
  }

  private bias(name: AnalystName, output: FusionInput[AnalystName]): Bias {
    switch (name) {
      case 'market': {
        const value = output as FusionInput['market'];
        return value.trend.direction === 'UP' ? 'BULLISH' : value.trend.direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL';
      }
      case 'technical': {
        const value = output as FusionInput['technical'];
        return value.trend.direction === 'UP' ? 'BULLISH' : value.trend.direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL';
      }
      case 'news': {
        const value = output as FusionInput['news'];
        return value.impact.direction === 'POSITIVE' ? 'BULLISH' : value.impact.direction === 'NEGATIVE' ? 'BEARISH' : 'NEUTRAL';
      }
      case 'sentiment':
        return (output as FusionInput['sentiment']).sentiment.overall;
      case 'macro': {
        const trend = (output as FusionInput['macro']).macroTrend;
        return trend === 'RISK_ON' ? 'BULLISH' : trend === 'RISK_OFF' ? 'BEARISH' : 'NEUTRAL';
      }
      case 'onchain': {
        const value = output as FusionInput['onchain'];
        const evidence = [...value.signals, value.flows.exchangeInflow, value.flows.exchangeOutflow]
          .filter((item): item is string => Boolean(item)).join(' ').toLowerCase();
        const bullish = /bullish|accumulat|net outflow|outflow (?:is )?(?:high|rising|increas)/.test(evidence);
        const bearish = /bearish|distribut|net inflow|inflow (?:is )?(?:high|rising|increas)/.test(evidence);
        return bullish === bearish ? 'NEUTRAL' : bullish ? 'BULLISH' : 'BEARISH';
      }
    }
  }

  private signals(input: DecisionInput, votes: Map<AnalystName, Bias>, weighting: Weighting) {
    const bullishFactors: string[] = [];
    const bearishFactors: string[] = [];
    votes.forEach((vote, name) => {
      const factor = `${this.label(name)} (${weighting[name]}%): ${input[name]?.summary}`;
      if (vote === 'BULLISH') bullishFactors.push(factor);
      if (vote === 'BEARISH') bearishFactors.push(factor);
    });
    return { bullishFactors, bearishFactors };
  }

  private risks(
    input: DecisionInput,
    votes: Map<AnalystName, Bias>,
    quality: AgentDataQuality,
    conflictLevel: ConflictLevel,
  ): string[] {
    const risks = new Set<string>();
    const values = [...votes.values()];
    if (values.includes('BULLISH') && values.includes('BEARISH')) {
      risks.add(`${conflictLevel} conflict between directional analyst signals.`);
    }
    if (quality !== 'GOOD') risks.add(`Decision data quality is ${quality.toLowerCase()}.`);
    if (this.detectRegime(input).type === 'HIGH_VOLATILITY') risks.add('High market volatility is present.');
    if (input.news?.impact.level === 'HIGH' || input.news?.keyEvents.some((event) => event.importance >= 80)) {
      risks.add('A major news event may cause abrupt market repricing.');
    }
    input.news?.riskSignals.forEach((risk) => risks.add(risk));
    input.macro?.riskFactors.forEach((risk) => risks.add(risk));
    input.fusionOutput.conflicts.forEach((risk) => risks.add(risk));
    return [...risks];
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  private label(name: AnalystName): string {
    return name === 'onchain' ? 'On-chain' : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
}
