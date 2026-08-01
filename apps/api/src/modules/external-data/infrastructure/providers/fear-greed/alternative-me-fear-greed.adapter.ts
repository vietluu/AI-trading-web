import { Injectable, Logger } from '@nestjs/common';
import { ExternalDataProvider } from '@prisma/client';
import {
  ProviderHealth,
  SentimentFetchContext,
  SentimentObservation,
  SentimentSourceAdapter,
} from '../../../domain/adapters/source-adapter.contracts';
import { ExternalDataError, ExternalDataErrorCode } from '../../../domain/errors/external-data.error';
import { ExternalHttpClient } from '../../http/external-http-client';

@Injectable()
export class AlternativeMeFearGreedAdapter implements SentimentSourceAdapter {
  readonly sourceId: string = 'alternative-me-fear-greed';
  readonly provider: ExternalDataProvider = ExternalDataProvider.ALTERNATIVE_ME_FEAR_GREED;

  private readonly logger = new Logger(AlternativeMeFearGreedAdapter.name);
  private readonly apiUrl = 'https://api.alternative.me/fng/';

  constructor(private readonly httpClient: ExternalHttpClient) {}

  async fetchLatest(context: SentimentFetchContext = {}): Promise<SentimentObservation[]> {
    const limit = Math.min(context.limit || 10, 100);
    const url = `${this.apiUrl}?limit=${limit}&format=json`;

    const response = await this.httpClient.fetch({ url });
    let parsed: any;
    try {
      parsed = JSON.parse(response.body);
    } catch (err: any) {
      throw new ExternalDataError({
        message: `Failed to parse Fear & Greed JSON payload: ${err.message}`,
        code: ExternalDataErrorCode.SOURCE_PARSE_FAILED,
        provider: this.provider,
        retryable: false,
        statusCode: 422,
      });
    }

    if (!parsed || !Array.isArray(parsed.data)) {
      throw new ExternalDataError({
        message: 'Invalid Fear & Greed response structure',
        code: ExternalDataErrorCode.SOURCE_INVALID_RESPONSE,
        provider: this.provider,
        retryable: false,
        statusCode: 422,
      });
    }

    const observations: SentimentObservation[] = [];
    for (const item of parsed.data) {
      const valNum = parseInt(item.value, 10);
      if (isNaN(valNum) || valNum < 0 || valNum > 100) continue;

      const timestampSec = parseInt(item.timestamp, 10);
      if (isNaN(timestampSec)) continue;

      const observedAt = new Date(timestampSec * 1000);
      // Validate observation timestamp is not in far future (> 1 day in future)
      if (observedAt.getTime() > Date.now() + 86400000) continue;

      observations.push({
        provider: 'alternative.me',
        indexType: 'FEAR_AND_GREED',
        value: valNum,
        classification: item.value_classification || this.classifyValue(valNum),
        observedAt,
        metadata: {
          timeUntilUpdate: item.time_until_update,
        },
      });
    }

    return observations;
  }

  private classifyValue(val: number): string {
    if (val <= 25) return 'Extreme Fear';
    if (val <= 45) return 'Fear';
    if (val <= 55) return 'Neutral';
    if (val <= 75) return 'Greed';
    return 'Extreme Greed';
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.provider,
      status: 'HEALTHY',
      latencyMs: 0,
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
    };
  }
}
