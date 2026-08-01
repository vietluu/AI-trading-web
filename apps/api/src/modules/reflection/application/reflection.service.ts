import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReflectionOutputSchema, type ReflectionOutput } from '@platform/shared';
import { calculatePerformanceMetrics } from '../domain/performance-calculator';
import { ReflectionRepository } from '../infrastructure/reflection.repository';
import { toDto } from './performance.service';

@Injectable()
export class ReflectionService {
  constructor(private readonly repository: ReflectionRepository, private readonly config: ConfigService) {}

  async generate(userId: string, persist = true): Promise<ReflectionOutput & { recordCount: number; ready: boolean }> {
    const rows = await this.repository.records(userId, undefined, 500);
    const records = rows.map(toDto);
    const minimum = this.config.get<number>('MIN_RECORDS_FOR_REFLECTION', 20);
    const metrics = calculatePerformanceMetrics(records);
    if (records.length < minimum) {
      return { summary: `Collecting evidence: ${records.length} of ${minimum} evaluated records are available.`, accuracy: metrics.accuracy, strengths: [], weaknesses: [], patterns: [], suggestions: [], generatedAt: new Date().toISOString(), recordCount: records.length, ready: false };
    }

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const patterns: string[] = [];
    const suggestions: string[] = [];
    if (metrics.accuracy >= 60) strengths.push(`Directional accuracy is ${metrics.accuracy}%.`);
    if (metrics.averageReturn > 0) strengths.push(`Average virtual return is positive at ${metrics.averageReturn}%.`);
    if (metrics.accuracy < 50) weaknesses.push(`Directional accuracy is below 50% (${metrics.accuracy}%).`);
    if (metrics.maxDrawdown >= 10) weaknesses.push(`Simulated drawdown is elevated at ${metrics.maxDrawdown}%.`);

    const directional = rows.filter((row) => row.decision !== 'WAIT');
    const accuracy = (subset: typeof rows) => subset.length ? subset.filter((r) => r.outcome === 'CORRECT').length / subset.length * 100 : null;
    const volatile = directional.filter((row) => row.highVolatility);
    const normal = directional.filter((row) => !row.highVolatility);
    const volatileAccuracy = accuracy(volatile);
    const normalAccuracy = accuracy(normal);
    if (volatileAccuracy != null && normalAccuracy != null && volatile.length >= 3 && volatileAccuracy + 10 < normalAccuracy) {
      patterns.push('Decisions underperform during high-volatility spikes.');
      weaknesses.push('Volatility regimes reduce directional reliability.');
      suggestions.push('Reduce confidence during high volatility or increase the WAIT threshold.');
    }
    const majorNews = directional.filter((row) => row.majorNews);
    const newsAccuracy = accuracy(majorNews);
    if (newsAccuracy != null && majorNews.length >= 3 && newsAccuracy < 50) {
      patterns.push('Decisions frequently fail after major news.');
      suggestions.push('Re-evaluate news weighting and ignore low-impact news; validate any change offline.');
    }
    const longCount = metrics.decisionDistribution.LONG;
    const shortCount = metrics.decisionDistribution.SHORT;
    if (longCount >= Math.max(5, shortCount * 2)) {
      patterns.push('Decision distribution has a LONG bias.');
      suggestions.push('Audit bullish feature weighting against an unchanged historical test set.');
    } else if (shortCount >= Math.max(5, longCount * 2)) {
      patterns.push('Decision distribution has a SHORT bias.');
      suggestions.push('Audit bearish feature weighting against an unchanged historical test set.');
    }
    const high = directional.filter((row) => row.confidence >= 70);
    const low = directional.filter((row) => row.confidence < 70);
    const highAccuracy = accuracy(high);
    const lowAccuracy = accuracy(low);
    if (highAccuracy != null && lowAccuracy != null) {
      patterns.push(`High-confidence accuracy is ${round(highAccuracy)}%; lower-confidence accuracy is ${round(lowAccuracy)}%.`);
      if (highAccuracy <= lowAccuracy) suggestions.push('Recalibrate confidence offline before considering threshold changes.');
    }
    if (!suggestions.length) suggestions.push('Keep current decision logic unchanged and continue collecting evaluation evidence.');
    if (!strengths.length) strengths.push('The system is preserving complete horizon-tagged evaluation evidence.');
    if (!weaknesses.length) weaknesses.push('No statistically clear weakness was detected in the current sample.');

    const output = ReflectionOutputSchema.parse({
      summary: `${records.length} horizon evaluations show ${metrics.accuracy}% directional accuracy, ${metrics.averageReturn}% average virtual return, and ${metrics.maxDrawdown}% maximum simulated drawdown.`,
      accuracy: metrics.accuracy, strengths, weaknesses, patterns, suggestions,
      generatedAt: new Date().toISOString(),
    });
    if (persist) await this.persistInsights(userId, weaknesses, patterns, metrics.maxDrawdown);
    return { ...output, recordCount: records.length, ready: true };
  }

  private async persistInsights(userId: string, weaknesses: string[], patterns: string[], drawdown: number) {
    const rows = [
      ...weaknesses.map((summary) => ({ summary, category: summary.toLowerCase().includes('drawdown') ? 'RISK' as const : 'DATA' as const, severity: drawdown >= 20 ? 'HIGH' as const : 'MEDIUM' as const })),
      ...patterns.map((summary) => ({ summary, category: summary.includes('bias') ? 'BIAS' as const : summary.includes('news') ? 'TIMING' as const : 'RISK' as const, severity: 'MEDIUM' as const })),
    ];
    if (rows.length) await this.repository.createInsights(userId, rows);
  }
}

function round(value: number) { return Math.round(value * 100) / 100; }
