import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import {
  DecisionInputSchema,
  DecisionOutputSchema,
  DecisionRunInputSchema,
  type AgentDataQuality,
  type DecisionInput,
  type DecisionOutput,
  type FusionInput,
  type MarketRegime,
} from '@platform/shared';
import { FusionService } from './fusion.service';
import type {
  AnalystName,
  Bias,
  ConflictLevel,
  RunDecisionOptions,
  Weighting,
} from '../../domain/types/decision-service.types';
import {
  BASE_WEIGHTS,
  DECISION_THRESHOLDS,
  QUALITY_FACTOR,
  REGIME_FACTOR,
} from '../../domain/constants/decision.constants';
import { PrismaService } from '../../../../database/prisma.service';

export type {
  AnalystName,
  Bias,
  ConflictLevel,
  RunDecisionOptions,
  Weighting,
};

@Injectable()
export class DecisionService {
  private readonly logger = new Logger(DecisionService.name);

  @Inject(PrismaService)
  @Optional()
  private readonly prisma?: PrismaService;

  constructor(
    private readonly fusionService: FusionService,
  ) {}

  public async run(options: RunDecisionOptions): Promise<DecisionOutput> {
    const input = DecisionRunInputSchema.parse(options.input);
    const result = await this.fusionService.runDetailed({ ...options, input });
    
    // Load Dynamic Self-Learning Configuration
    const config = (options.userId && this.prisma)
      ? await this.prisma.selfLearningConfiguration.findUnique({
          where: { userId: options.userId },
        })
      : null;

    const customWeights = config?.weightsJson
      ? (config.weightsJson as Weighting)
      : undefined;

    const decisionOptions = config
      ? {
          weights: customWeights,
          confidenceThreshold: config.confidenceThreshold,
          volatilityPenalty: config.volatilityPenalty,
        }
      : undefined;

    const decision = this.decide({
      symbol: input.symbol,
      fusionOutput: result.fusionOutput,
      ...result.analyses,
    }, decisionOptions);

    // Phase C: Shadow Mode Simulation Run
    if (config?.shadowEnabled && options.userId && this.prisma) {
      const shadowWeights = config.shadowWeightsJson
        ? (config.shadowWeightsJson as Weighting)
        : undefined;
      const shadowThreshold = config.shadowThreshold ?? undefined;
      
      const shadowDecision = this.decide({
        symbol: input.symbol,
        fusionOutput: result.fusionOutput,
        ...result.analyses,
      }, {
        weights: shadowWeights,
        confidenceThreshold: shadowThreshold,
        volatilityPenalty: config.volatilityPenalty,
      });

      if (shadowDecision.decision !== 'WAIT') {
        let lastPrice = 0;
        const lastCandle = await this.prisma.marketCandle.findFirst({
          where: { symbol: input.symbol, provider: input.provider, isClosed: true },
          orderBy: { closeTime: 'desc' },
          select: { close: true },
        });
        if (lastCandle) lastPrice = Number(lastCandle.close);

        await this.prisma.paperSignal.create({
          data: {
            userId: options.userId,
            pipelineRunId: options.correlationId,
            symbol: input.symbol,
            decision: shadowDecision.decision,
            confidence: shadowDecision.confidence,
            mode: 'SHADOW',
            referencePrice: lastPrice,
            outcome: 'PENDING',
          },
        }).catch((err: unknown) => {
          if (err instanceof Error) {
            this.logger.warn(`Failed to record shadow signal: ${err.message}`);
          }
        });
      }
    }

    return decision;
  }

  public decide(
    rawInput: DecisionInput,
    customOptions?: { weights?: Weighting; confidenceThreshold?: number; volatilityPenalty?: number },
  ): DecisionOutput {
    const input = DecisionInputSchema.parse(rawInput);
    const names = Object.keys(BASE_WEIGHTS) as AnalystName[];
    const regime = this.detectRegime(input);
    const weighting = this.dynamicWeights(regime.type, customOptions?.weights);
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
    if (directionalBias >= DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD && bullishCount > bearishCount) candidate = 'LONG';
    if (directionalBias <= -DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD && bearishCount > bullishCount) candidate = 'SHORT';

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
      directionalBias >= DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD &&
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
    const dataQuality = this.dataQuality(input, active);
    const { adjustment: volatilityAdjustment, extreme } = this.volatilityFilter(input, customOptions?.volatilityPenalty);
    if (volatilityAdjustment < 0) {
      overrides.push(`High volatility reduced confidence by ${Math.abs(volatilityAdjustment)}%.`);
    }
    if (extreme) overrides.push('Extreme volatility forced WAIT.');

    if (conflictLevel === 'MEDIUM') {
      overrides.push('Medium signal conflict reduced calibrated confidence by 10%.');
    }
    if (conflictLevel === 'HIGH') overrides.push('Strong signal conflict forced WAIT.');

    // Check core analyst alignment (Market + Technical)
    const marketBias = votes.get('market');
    const techBias = votes.get('technical');
    const targetBias: Bias = candidate === 'LONG' ? 'BULLISH' : candidate === 'SHORT' ? 'BEARISH' : 'NEUTRAL';
    const coreAgree = candidate !== 'WAIT' && marketBias === targetBias && techBias === targetBias;
    if (coreAgree) overrides.push('Market and Technical trend alignment boosted confidence by +10%.');

    // Calibrated confidence calculation using weighted adjustments
    const qualityDeduction = dataQuality === 'PARTIAL' ? DECISION_THRESHOLDS.QUALITY_PARTIAL_DEDUCTION : dataQuality === 'INSUFFICIENT' ? DECISION_THRESHOLDS.QUALITY_INSUFFICIENT_DEDUCTION : 0;
    const conflictDeduction = conflictLevel === 'MEDIUM' ? DECISION_THRESHOLDS.CONFLICT_MEDIUM_PENALTY : conflictLevel === 'HIGH' ? DECISION_THRESHOLDS.CONFLICT_HIGH_PENALTY : 0;
    const volDeduction = Math.abs(volatilityAdjustment);
    const coreBonus = coreAgree ? DECISION_THRESHOLDS.CORE_TREND_ALIGNMENT_BONUS : 0;
    const convictionBonus = agreementScore >= 80 && baseScore >= 70 ? 8 : agreementScore >= 70 && baseScore >= 60 ? 4 : 0;

    const rawConfidence = baseScore + coreBonus + convictionBonus - qualityDeduction - conflictDeduction - volDeduction;
    const confidence = candidate === 'WAIT' ? 0 : Math.round(this.clamp(rawConfidence, 0, 100));

    const minConfidence = customOptions?.confidenceThreshold ?? DECISION_THRESHOLDS.MINIMUM_CONFIDENCE_THRESHOLD;
    if (confidence < minConfidence && candidate !== 'WAIT') {
      overrides.push(`Calibrated confidence below ${minConfidence} forced WAIT.`);
    }
    if (dataQuality === 'INSUFFICIENT') overrides.push('Insufficient data forced WAIT.');

    const signals = this.signals(input, votes, weighting);
    const risks = this.risks(input, votes, dataQuality, conflictLevel);
    const opportunityScore = this.calculateOpportunityScore(input, regime, votes, weighting, dataQuality);
    const { adaptiveThreshold, calibrationAdjustment } = this.calculateAdaptiveThresholds(input, regime, confidence, opportunityScore, conflictLevel);
    const calibratedConfidence = this.clamp(confidence + calibrationAdjustment, 0, 100);
    const expectedWinProbability = this.clamp((calibratedConfidence / 100) * 0.75 + opportunityScore / 100 * 0.2, 0, 1);
    const expectedReward = this.clamp((opportunityScore / 100) * 3 + 0.5, 0.2, 5);
    const expectedLoss = this.clamp((100 - opportunityScore) / 100 * 1.4 + 0.4, 0.2, 3);
    const expectedValue = this.clamp(expectedWinProbability * expectedReward - (1 - expectedWinProbability) * expectedLoss, -3, 3);
    const profitFactorEstimate = this.clamp(expectedReward / Math.max(expectedLoss, 0.05), 0.1, 10);
    const riskScore = this.clamp(50 + (volatilityAdjustment * -0.4) + (conflictLevel === 'HIGH' ? 15 : conflictLevel === 'MEDIUM' ? 8 : 0) + Math.max(0, 100 - opportunityScore) * 0.2, 0, 100);
    const executionCost = this.estimateExecutionCost(input, opportunityScore, regime.type);
    const strongConviction = agreementScore >= 80 && opportunityScore >= 68 && expectedValue > 0.2;
    const adaptiveThresholdValue = customOptions?.confidenceThreshold ?? adaptiveThreshold;
    const finalDecision: DecisionOutput['decision'] =
      dataQuality === 'INSUFFICIENT' ||
      conflictLevel === 'HIGH' ||
      extreme ||
      (calibratedConfidence < adaptiveThresholdValue && !strongConviction) ||
      (expectedValue <= 0 && !strongConviction) ||
      (opportunityScore < Math.max(55, adaptiveThresholdValue - 5) && !strongConviction)
        ? 'WAIT'
        : candidate;

    if (strongConviction) {
      overrides.push('Strong conviction override allowed the decision to proceed despite a higher guardrail threshold.');
    }
    const weightedBias =
      directionalBias > 0 ? 'bullish' : directionalBias < 0 ? 'bearish' : 'neutral';
    const output = DecisionOutputSchema.parse({
      decision: finalDecision,
      confidence: Math.round(calibratedConfidence),
      reasoning: `${active.length} of 6 analysts supplied usable data. The ${regime.type.toLowerCase().replace('_', ' ')} regime produced a normalized ${weightedBias} bias of ${Math.round(directionalBias)}, ${agreementScore}% analyst agreement, and ${Math.round(baseScore)}% weighted alignment. Calibrated confidence is ${Math.round(calibratedConfidence)}% with ${dataQuality} data and ${conflictLevel} conflict.`,
      signals,
      risks,
      agreementScore,
      dataQuality,
      regime,
      weighting,
      overrides: [...new Set(overrides)],
      volatilityAdjustment,
      conflictLevel,
      opportunityScore: Math.round(opportunityScore),
      expectedWinProbability: Number(expectedWinProbability.toFixed(3)),
      expectedReward: Number(expectedReward.toFixed(3)),
      expectedLoss: Number(expectedLoss.toFixed(3)),
      expectedValue: Number(expectedValue.toFixed(3)),
      profitFactorEstimate: Number(profitFactorEstimate.toFixed(3)),
      riskScore: Math.round(riskScore),
      adaptiveThreshold: Math.round(adaptiveThreshold),
      calibrationAdjustment: Number(calibrationAdjustment.toFixed(2)),
      executionCost: Number(executionCost.toFixed(3)),
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
        coreBonus,
        qualityDeduction,
        conflictDeduction,
        volDeduction,
        dataQualityFactor: QUALITY_FACTOR[dataQuality],
        regimeFactor: REGIME_FACTOR[regime.type],
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

  private dynamicWeights(regime: MarketRegime['type'], customWeights?: Weighting): Weighting {
    const weights = { ...(customWeights || BASE_WEIGHTS) };
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
      return DECISION_THRESHOLDS.NEWS_NEGATIVE_SHOCK;
    }
    if (input.news.impact.direction === 'POSITIVE') {
      overrides.push('Applied a +10 directional news-shock adjustment.');
      return DECISION_THRESHOLDS.NEWS_POSITIVE_SHOCK;
    }
    return 0;
  }

  private volatilityFilter(input: DecisionInput, customPenalty?: number): {
    factor: number;
    adjustment: number;
    extreme: boolean;
  } {
    const penalty = customPenalty ?? 20;
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
      ? { factor: 0.7, adjustment: -Math.round(penalty * 1.5), extreme: true }
      : { factor: 0.8, adjustment: -Math.round(penalty), extreme: false };
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
    if (namedConflicts >= 2 || (hasBothDirections && Math.abs(directionalBias) < DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD)) return 'HIGH';
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

  private calculateOpportunityScore(
    input: DecisionInput,
    regime: MarketRegime,
    votes: Map<AnalystName, Bias>,
    weighting: Weighting,
    quality: AgentDataQuality,
  ): number {
    const trendStrength = input.market?.trend.strength === 'STRONG' ? 1 : input.technical?.trend.strength === 'STRONG' ? 0.9 : 0.65;
    const momentum = input.technical?.momentum.rsiState === 'OVERSOLD' || input.technical?.momentum.rsiState === 'OVERBOUGHT' ? 0.75 : 0.85;
    const volume = input.market?.liquidity?.volumeProfile === true ? 0.8 : 0.7;
    const liquidity = input.market?.liquidity?.spread !== undefined ? 0.8 : 0.65;
    const atr = input.market?.volatility.level === 'LOW' ? 0.7 : input.market?.volatility.level === 'HIGH' ? 0.55 : 0.75;
    const funding = input.market?.derivatives?.fundingRate ? 0.75 : 0.7;
    const openInterest = input.market?.derivatives?.openInterest ? 0.8 : 0.7;
    const structure = input.technical?.structure.marketStructure === 'HH_HL' || input.technical?.structure.marketStructure === 'LL_LH' ? 0.85 : 0.7;
    const higherTimeframe = regime.type === 'TRENDING' ? 0.9 : regime.type === 'HIGH_VOLATILITY' ? 0.6 : 0.75;
    const newsImpact = input.news?.impact.level === 'HIGH' ? 0.7 : input.news?.impact.level === 'MEDIUM' ? 0.8 : 0.65;
    const sentiment = input.sentiment?.sentiment.overall === 'BULLISH' ? 0.8 : input.sentiment?.sentiment.overall === 'BEARISH' ? 0.7 : 0.6;
    const macro = input.macro?.macroTrend === 'RISK_ON' ? 0.8 : input.macro?.macroTrend === 'RISK_OFF' ? 0.6 : 0.7;
    const patternSimilarity = Math.max(0.55, 0.7 + (votes.size / 10) * 0.05);
    const historicalWinRate = quality === 'GOOD' ? 0.8 : quality === 'PARTIAL' ? 0.65 : 0.5;
    const riskReward = input.market?.volatility.level === 'LOW' ? 0.8 : 0.7;
    const executionCost = 0.72;
    const confidence = this.clamp((this.voteWeight(votes, weighting) / 100) * 0.95 + 0.05, 0, 1);
    const score = (
      trendStrength * 12 +
      momentum * 10 +
      volume * 8 +
      liquidity * 8 +
      atr * 8 +
      funding * 7 +
      openInterest * 7 +
      structure * 8 +
      higherTimeframe * 8 +
      newsImpact * 7 +
      sentiment * 6 +
      macro * 6 +
      patternSimilarity * 7 +
      historicalWinRate * 8 +
      riskReward * 8 +
      executionCost * 6 +
      confidence * 10
    );
    return this.clamp(score, 0, 100);
  }

  private calculateAdaptiveThresholds(
    input: DecisionInput,
    regime: MarketRegime,
    confidence: number,
    opportunityScore: number,
    conflictLevel: DecisionOutput['conflictLevel'],
  ): { adaptiveThreshold: number; calibrationAdjustment: number } {
    const base = regime.type === 'TRENDING' ? 62 : regime.type === 'HIGH_VOLATILITY' ? 78 : 72;
    const volatilityAdjustment = input.market?.volatility.level === 'HIGH' ? 8 : input.market?.volatility.level === 'LOW' ? -3 : 0;
    const liquidityAdjustment = input.market?.liquidity?.spread !== undefined ? 4 : 0;
    const opportunityAdjustment = opportunityScore < 65 ? 9 : opportunityScore > 80 ? -4 : 0;
    const conflictAdjustment = conflictLevel === 'HIGH' ? 7 : conflictLevel === 'MEDIUM' ? 3 : 0;
    const threshold = this.clamp(base + volatilityAdjustment + liquidityAdjustment + opportunityAdjustment + conflictAdjustment, 55, 90);
    const calibrationAdjustment = confidence > threshold ? 4 : confidence < threshold - 8 ? -6 : 0;
    return { adaptiveThreshold: threshold, calibrationAdjustment };
  }

  private estimateExecutionCost(input: DecisionInput, opportunityScore: number, regime: MarketRegime['type']): number {
    const spreadPenalty = input.market?.liquidity?.spread !== undefined ? Math.min(0.25, Number(input.market.liquidity.spread) / 1000) : 0.05;
    const volatilityPenalty = regime === 'HIGH_VOLATILITY' ? 0.1 : 0.04;
    const slippage = Math.max(0.01, spreadPenalty + volatilityPenalty + (100 - opportunityScore) / 1000);
    return Number(slippage.toFixed(3));
  }

  private voteWeight(votes: Map<AnalystName, Bias>, weighting: Weighting): number {
    const total = [...votes.values()].reduce((sum, vote) => sum + (vote === 'BULLISH' ? weighting.market : vote === 'BEARISH' ? weighting.news : 0), 0);
    return this.clamp(total, 0, 100);
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
