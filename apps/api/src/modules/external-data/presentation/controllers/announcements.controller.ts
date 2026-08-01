import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../database/prisma.service';

@ApiTags('External Data - Exchange Announcements')
@Controller('external-data/announcements')
export class AnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get exchange announcements' })
  async getAnnouncements(
    @Query('provider') provider?: string,
    @Query('category') category?: string,
    @Query('symbol') symbol?: string,
    @Query('page') pageStr: string = '1',
    @Query('limit') limitStr: string = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr, 10), 1), 100);

    const where: any = {};
    if (provider) where.provider = provider;
    if (category) where.category = category;
    if (symbol) where.relatedSymbols = { has: symbol.toUpperCase() };

    const total = await this.prisma.exchangeAnnouncement.count({ where });
    const items = await this.prisma.exchangeAnnouncement.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { publishedAt: 'desc' },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        externalId: item.externalId,
        provider: item.provider,
        category: item.category,
        title: item.title,
        summary: item.summary,
        canonicalUrl: item.canonicalUrl,
        publishedAt: item.publishedAt.toISOString(),
        receivedAt: item.receivedAt.toISOString(),
        relatedSymbols: item.relatedSymbols,
        importanceScore: item.importanceScore,
        sourceReliabilityScore: item.sourceReliabilityScore,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get announcement by ID' })
  async getAnnouncementById(@Param('id') id: string) {
    const announcement = await this.prisma.exchangeAnnouncement.findUnique({
      where: { id },
    });
    if (!announcement) {
      throw new NotFoundException(`Announcement ${id} not found`);
    }
    return {
      ...announcement,
      publishedAt: announcement.publishedAt.toISOString(),
      receivedAt: announcement.receivedAt.toISOString(),
    };
  }
}
