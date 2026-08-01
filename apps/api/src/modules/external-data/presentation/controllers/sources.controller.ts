import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { SessionGuard } from '../../../../session/session.guard';
import { ExternalHttpClient } from '../../infrastructure/http/external-http-client';
import { GenericRssAdapter } from '../../infrastructure/providers/rss/generic-rss.adapter';
import { createExternalDataSourceSchema, updateExternalDataSourceSchema } from '@platform/shared';

@ApiTags('External Data - Source Management')
@Controller('external-data/sources')
export class SourcesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpClient: ExternalHttpClient,
    private readonly rssAdapter: GenericRssAdapter,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all configured news sources' })
  async getSources() {
    return this.prisma.externalDataSource.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Add a new custom RSS/Atom news source with SSRF validation' })
  async createSource(@Body() body: Record<string, unknown>) {
    const validated = createExternalDataSourceSchema.parse(body);

    // Validate SSRF target safety before saving
    const parsedUrl = new URL(validated.feedUrl);
    await this.httpClient.validateSsrfTarget(parsedUrl.hostname);

    return this.prisma.externalDataSource.create({
      data: {
        sourceId: validated.sourceId,
        displayName: validated.displayName,
        feedUrl: validated.feedUrl,
        baseDomain: parsedUrl.hostname,
        language: validated.language,
        categories: validated.categories,
        reliabilityScore: validated.reliabilityScore,
        pollIntervalSeconds: validated.pollIntervalSeconds,
        isCustom: true,
      },
    });
  }

  @Patch(':id')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Update an existing news source' })
  async updateSource(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const validated = updateExternalDataSourceSchema.parse(body);

    const source = await this.prisma.externalDataSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }

    if (validated.feedUrl) {
      const parsedUrl = new URL(validated.feedUrl);
      await this.httpClient.validateSsrfTarget(parsedUrl.hostname);
    }

    return this.prisma.externalDataSource.update({
      where: { id },
      data: validated as Prisma.ExternalDataSourceUpdateInput,
    });
  }

  @Delete(':id')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Delete a custom news source' })
  async deleteSource(@Param('id') id: string) {
    const source = await this.prisma.externalDataSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }
    return this.prisma.externalDataSource.delete({ where: { id } });
  }

  @Post(':id/test')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Test fetch for a configured source' })
  async testSource(@Param('id') id: string) {
    const source = await this.prisma.externalDataSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }

    const fetchResult = await this.rssAdapter.fetchLatest({
      sourceId: source.sourceId,
      feedUrl: source.feedUrl,
    });

    return {
      sourceId: source.sourceId,
      feedUrl: source.feedUrl,
      itemsFetched: fetchResult.items.length,
      sampleTitle: fetchResult.items[0]?.title || null,
      samplePublishedAt: fetchResult.items[0]?.publishedAt || null,
      status: 'SUCCESS',
    };
  }
}
