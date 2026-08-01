import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../database/prisma.service';

@ApiTags('External Data - Market Sentiment')
@Controller('external-data/sentiment')
export class SentimentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get current Fear & Greed market sentiment index' })
  async getCurrentSentiment() {
    const latest = await this.prisma.marketSentimentObservation.findFirst({
      orderBy: { observedAt: 'desc' },
    });

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

    const isStale = (Date.now() - latest.observedAt.getTime()) > 48 * 60 * 60 * 1000;

    return {
      id: latest.id,
      provider: latest.provider,
      indexType: latest.indexType,
      value: latest.value,
      classification: latest.classification,
      observedAt: latest.observedAt.toISOString(),
      receivedAt: latest.receivedAt.toISOString(),
      isStale,
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
