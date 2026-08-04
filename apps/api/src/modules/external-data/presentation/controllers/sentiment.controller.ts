import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../database/prisma.service';
import { AlternativeMeFearGreedAdapter } from '../../infrastructure/providers/fear-greed/alternative-me-fear-greed.adapter';

@ApiTags('External Data - Market Sentiment')
@Controller('external-data/sentiment')
export class SentimentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fearGreedAdapter: AlternativeMeFearGreedAdapter,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get current Fear & Greed market sentiment index' })
  async getCurrentSentiment() {
    let latest = await this.prisma.marketSentimentObservation.findFirst({
      orderBy: { observedAt: 'desc' },
    });

    const isStale = !latest || (Date.now() - latest.observedAt.getTime()) > 24 * 60 * 60 * 1000;

    if (isStale) {
      try {
        const fetched = await this.fearGreedAdapter.fetchLatest({ limit: 10 });
        for (const obs of fetched) {
          await this.prisma.marketSentimentObservation.upsert({
            where: {
              provider_indexType_observedAt: {
                provider: obs.provider,
                indexType: obs.indexType as any,
                observedAt: obs.observedAt,
              },
            },
            create: {
              provider: obs.provider,
              indexType: obs.indexType as any,
              value: obs.value,
              classification: obs.classification,
              observedAt: obs.observedAt,
              metadata: obs.metadata ? (obs.metadata as any) : undefined,
            },
            update: {
              value: obs.value,
              classification: obs.classification,
            },
          });
        }
        latest = await this.prisma.marketSentimentObservation.findFirst({
          orderBy: { observedAt: 'desc' },
        });
      } catch {
        // Fallback to existing record if network request fails
      }
    }

    if (!latest) {
      return {
        provider: 'alternative.me',
        indexType: 'FEAR_AND_GREED',
        value: 50,
        classification: 'Neutral',
        observedAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        isStale: true,
      };
    }

    return {
      id: latest.id,
      provider: latest.provider,
      indexType: latest.indexType,
      value: latest.value,
      classification: latest.classification,
      observedAt: latest.observedAt.toISOString(),
      receivedAt: latest.receivedAt.toISOString(),
      isStale: (Date.now() - latest.observedAt.getTime()) > 24 * 60 * 60 * 1000,
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get historical market sentiment observations' })
  async getSentimentHistory(@Query('limit') limitStr: string = '30') {
    const limit = Math.min(Math.max(parseInt(limitStr, 10), 1), 365);
    const history = await this.prisma.marketSentimentObservation.findMany({
      take: limit,
      orderBy: { observedAt: 'desc' },
    });

    return history.map((item) => ({
      id: item.id,
      provider: item.provider,
      indexType: item.indexType,
      value: item.value,
      classification: item.classification,
      observedAt: item.observedAt.toISOString(),
      receivedAt: item.receivedAt.toISOString(),
    }));
  }
}
