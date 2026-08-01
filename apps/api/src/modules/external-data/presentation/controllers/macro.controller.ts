import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MacroEventCategory,
  MacroEventStatus,
  MacroImportance,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { SessionGuard } from '../../../../session/session.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { MacroImportService } from '../../application/services/macro-import.service';
import {
  MacroImportConfirmRequest,
  macroImportConfirmRequestSchema,
} from '@platform/shared';

@ApiTags('External Data - Macroeconomic Calendar')
@Controller('external-data/macro')
export class MacroController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly macroImportService: MacroImportService,
  ) {}

  @Get('events')
  @ApiOperation({ summary: 'Get macroeconomic calendar events' })
  async getMacroEvents(
    @Query('importance') importance?: string,
    @Query('category') category?: string,
    @Query('country') country?: string,
    @Query('status') status?: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
    @Query('page') pageStr: string = '1',
    @Query('limit') limitStr: string = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr, 10), 1), 100);

    const where: Prisma.MacroEconomicEventWhereInput = {};
    if (importance) where.importance = importance as MacroImportance;
    if (category) where.category = category as MacroEventCategory;
    if (country) where.country = country;
    if (status) where.status = status as MacroEventStatus;

    if (startDateStr || endDateStr) {
      where.scheduledAt = {};
      if (startDateStr) where.scheduledAt.gte = new Date(startDateStr);
      if (endDateStr) where.scheduledAt.lte = new Date(endDateStr);
    }

    const total = await this.prisma.macroEconomicEvent.count({ where });
    const items = await this.prisma.macroEconomicEvent.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { scheduledAt: 'asc' },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        provider: item.provider,
        externalId: item.externalId,
        name: item.name,
        country: item.country,
        currency: item.currency,
        category: item.category,
        importance: item.importance,
        scheduledAt: item.scheduledAt.toISOString(),
        actual: item.actual,
        forecast: item.forecast,
        previous: item.previous,
        unit: item.unit,
        status: item.status,
        sourceUrl: item.sourceUrl,
        receivedAt: item.receivedAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Get macroeconomic event by ID' })
  async getMacroEventById(@Param('id') id: string) {
    const event = await this.prisma.macroEconomicEvent.findUnique({
      where: { id },
    });
    if (!event) {
      throw new NotFoundException(`Macro event ${id} not found`);
    }
    return {
      ...event,
      scheduledAt: event.scheduledAt.toISOString(),
      receivedAt: event.receivedAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }

  @Post('import/preview')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Preview dry-run of manual macro CSV or JSON file import' })
  async previewImport(
    @Body('fileContent') fileContent: string,
    @Body('fileFormat') fileFormat: 'csv' | 'json' = 'csv',
  ) {
    if (!fileContent) {
      throw new NotFoundException('fileContent must be provided');
    }
    return Promise.resolve(this.macroImportService.previewImport(fileContent, fileFormat));
  }

  @Post('import')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Confirm and execute manual macro event import' })
  async confirmImport(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: { id: string },
  ) {
    const validatedRequest = macroImportConfirmRequestSchema.parse(body);
    return this.macroImportService.confirmImport(user.id, validatedRequest);
  }
}
