import { Injectable } from '@nestjs/common';
import {
  ImportanceAssessment,
  ImportanceInput,
} from '../../domain/scoring/importance-scoring.types';

@Injectable()
export class DeterministicImportanceScorer {
  readonly scoringVersion = 1;

  calculateScore(input: ImportanceInput): ImportanceAssessment {
    let score = 0;
    const reasons: string[] = [];

    // 1. Source Reliability (Base contribution up to 35 pts)
    const reliabilityContrib = Math.round((input.sourceReliabilityScore / 100) * 35);
    score += reliabilityContrib;
    reasons.push(`Source reliability (${input.sourceReliabilityScore}/100): +${reliabilityContrib} pts`);

    // 2. Official Source Bonus (+15 pts)
    if (input.isOfficialSource) {
      score += 15;
      reasons.push('Official source confirmation: +15 pts');
    }

    // 3. Category Impact (+10 to +30 pts)
    const inferredCategory = input.category ?? input.topics?.find((topic) =>
      ['REGULATION', 'ETF', 'MACRO', 'CPI', 'FOMC', 'INTEREST_RATE_DECISION', 'SECURITY'].includes(topic.toUpperCase()),
    );
    if (inferredCategory) {
      const cat = inferredCategory.toUpperCase();
      if (['LISTING', 'DELISTING', 'FUTURES_LAUNCH', 'SECURITY', 'SECURITY_NOTICE'].includes(cat)) {
        score += 30;
        reasons.push(`High impact category (${inferredCategory}): +30 pts`);
      } else if (['REGULATION', 'ETF', 'MARGIN_RULES', 'TRADING_SUSPENSION'].includes(cat)) {
        score += 25;
        reasons.push(`Medium-high impact category (${inferredCategory}): +25 pts`);
      } else if (['MACRO', 'CPI', 'FOMC', 'INTEREST_RATE_DECISION'].includes(cat)) {
        score += 20;
        reasons.push(`Macro category (${inferredCategory}): +20 pts`);
      } else {
        score += 10;
        reasons.push(`General news category (${inferredCategory}): +10 pts`);
      }
    }

    // Systemic crypto-policy events affect the whole market even when an RSS
    // item is not tagged with every tradable symbol.
    const eventText = `${input.title} ${input.summary ?? ''} ${(input.topics ?? []).join(' ')} ${(input.entities ?? []).map((item) => item.entity).join(' ')}`;
    if (
      /crypto|bitcoin|digital asset|clarity act|stablecoin|cftc|sec\b/i.test(eventText) &&
      /president|white house|congress|senate|treasury|cftc|sec\b|regulat/i.test(eventText)
    ) {
      score += 15;
      reasons.push('Systemic crypto-policy event: +15 pts');
    }

    // 4. Incident Severity (+5 to +40 pts)
    if (input.incidentSeverity) {
      switch (input.incidentSeverity) {
        case 'CRITICAL':
          score += 40;
          reasons.push('Critical incident severity: +40 pts');
          break;
        case 'HIGH':
          score += 30;
          reasons.push('High incident severity: +30 pts');
          break;
        case 'MEDIUM':
          score += 15;
          reasons.push('Medium incident severity: +15 pts');
          break;
        case 'LOW':
          score += 5;
          reasons.push('Low incident severity: +5 pts');
          break;
      }
    }

    // 5. Multi-Source Confirmation (+5 per duplicate up to +15 pts)
    if (input.duplicateCount > 1) {
      const dupBonus = Math.min((input.duplicateCount - 1) * 5, 15);
      score += dupBonus;
      reasons.push(`Multi-source confirmation (${input.duplicateCount} sources): +${dupBonus} pts`);
    }

    // 6. Asset Coverage (+5 per symbol up to +15 pts)
    if (input.relatedSymbolsCount > 0) {
      const symbolBonus = Math.min(input.relatedSymbolsCount * 5, 15);
      score += symbolBonus;
      reasons.push(`Asset relevance (${input.relatedSymbolsCount} symbols): +${symbolBonus} pts`);
    }

    // 7. Freshness Decay (-5 per 24 hours age)
    const ageHours = (Date.now() - input.publishedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
      const ageDays = Math.floor(ageHours / 24);
      const decay = Math.min(ageDays * 5, 30);
      score -= decay;
      reasons.push(`Age decay (${ageDays} days old): -${decay} pts`);
    }

    // Bound final score between 0 and 100
    const finalScore = Math.max(0, Math.min(100, score));

    let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (finalScore >= 90) {
      level = 'CRITICAL';
    } else if (finalScore >= 70) {
      level = 'HIGH';
    } else if (finalScore >= 40) {
      level = 'MEDIUM';
    }

    return {
      score: finalScore,
      level,
      reasons,
      scoringVersion: this.scoringVersion,
    };
  }
}
