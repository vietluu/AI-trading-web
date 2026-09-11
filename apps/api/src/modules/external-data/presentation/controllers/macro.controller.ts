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
import { ExternalDataEventBus } from '../../application/services/external-data-event-bus.service';
import { scoreMacroTrend } from '../../../agents/domain/definitions/macro-analyst.definition';
import { Optional } from '@nestjs/common';

@ApiTags('External Data - Macroeconomic Calendar')
@Controller('external-data/macro')
export class MacroController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly macroImportService: MacroImportService,
    @Optional() private readonly eventBus?: ExternalDataEventBus,
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
      if (startDateStr) {
        const startDate = new Date(startDateStr);
        if (Number.isNaN(startDate.getTime())) {
          throw new BadRequestException('startDate must be a valid date');
        }
        where.scheduledAt.gte = startDate;
      }
      if (endDateStr) {
        const endDate = new Date(endDateStr);
        if (Number.isNaN(endDate.getTime())) {
          throw new BadRequestException('endDate must be a valid date');
        }
        where.scheduledAt.lte = endDate;
      }
    } else {
      // The default calendar view is operational, not archival. Without this
      // bound, ascending pagination starts at the oldest imported year and
      // hides the current/upcoming releases on later pages.
      where.scheduledAt = {
        gte: new Date(Date.now() - 24 * 60 * 60_000),
      };
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

  @Post('live-release')
  @ApiOperation({ summary: 'Ingest immediate real-time macroeconomic event release' })
  async ingestLiveRelease(
    @Body()
    body: {
      name: string;
      category?: MacroEventCategory;
      importance?: MacroImportance;
      country?: string;
      currency?: string;
      actual: string | number;
      forecast?: string | number | null;
      previous?: string | number | null;
      unit?: string | null;
      scheduledAt?: string;
      sourceUrl?: string;
    },
  ) {
    if (!body || !body.name || body.actual === undefined || body.actual === null || body.actual === '') {
      throw new BadRequestException('Event name and actual release value are required');
    }

    const actualStr = String(body.actual).trim();
    const forecastStr = body.forecast !== undefined && body.forecast !== null ? String(body.forecast).trim() : null;
    const previousStr = body.previous !== undefined && body.previous !== null ? String(body.previous).trim() : null;

    let scheduledAtDate: Date;
    if (body.scheduledAt) {
      scheduledAtDate = new Date(body.scheduledAt);
      if (Number.isNaN(scheduledAtDate.getTime())) {
        throw new BadRequestException('scheduledAt must be a valid ISO date');
      }
    } else {
      scheduledAtDate = new Date();
    }

    const category: MacroEventCategory = body.category ?? (
      /consumer price|\bcpi\b/i.test(body.name) ? 'CPI' :
      /producer price|\bppi\b/i.test(body.name) ? 'PPI' :
      /nonfarm|payroll/i.test(body.name) ? 'NONFARM_PAYROLLS' :
      /unemployment/i.test(body.name) ? 'UNEMPLOYMENT' :
      /retail sales/i.test(body.name) ? 'RETAIL_SALES' : 'OTHER'
    );

    const importance: MacroImportance = body.importance ?? (
      ['CPI', 'PPI', 'NONFARM_PAYROLLS', 'UNEMPLOYMENT'].includes(category) ||
      /fomc|interest rate|fed/i.test(body.name)
        ? 'HIGH'
        : 'MEDIUM'
    );

    // Look for existing scheduled event around this date (+- 12 hours)
    const existing = await this.prisma.macroEconomicEvent.findFirst({
      where: {
        name: { contains: body.name.split(' ')[0], mode: 'insensitive' },
        scheduledAt: {
          gte: new Date(scheduledAtDate.getTime() - 12 * 60 * 60_000),
          lte: new Date(scheduledAtDate.getTime() + 12 * 60 * 60_000),
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    let savedEvent;
    if (existing) {
      savedEvent = await this.prisma.macroEconomicEvent.update({
        where: { id: existing.id },
        data: {
          actual: actualStr,
          ...(forecastStr !== null ? { forecast: forecastStr } : {}),
          ...(previousStr !== null ? { previous: previousStr } : {}),
          status: 'RELEASED',
          updatedAt: new Date(),
        },
      });
    } else {
      savedEvent = await this.prisma.macroEconomicEvent.create({
        data: {
          provider: 'LIVE_FEED',
          name: body.name,
          category,
          importance,
          country: body.country ?? 'US',
          currency: body.currency ?? 'USD',
          scheduledAt: scheduledAtDate,
          actual: actualStr,
          forecast: forecastStr,
          previous: previousStr,
          unit: body.unit ?? null,
          status: 'RELEASED',
          sourceUrl: body.sourceUrl ?? null,
        },
      });
    }

    const macroTrend = scoreMacroTrend([{
      name: savedEvent.name,
      importance: savedEvent.importance,
      actual: savedEvent.actual,
      forecast: savedEvent.forecast,
    }]);

    const actualNum = parseFloat(actualStr);
    const forecastNum = forecastStr ? parseFloat(forecastStr) : NaN;
    const surprise = Number.isFinite(actualNum) && Number.isFinite(forecastNum)
      ? actualNum - forecastNum
      : null;

    if (this.eventBus) {
      this.eventBus.emitMacroRelease({
        id: savedEvent.id,
        name: savedEvent.name,
        category: savedEvent.category,
        importance: savedEvent.importance,
        actual: savedEvent.actual!,
        forecast: savedEvent.forecast,
        previous: savedEvent.previous,
        unit: savedEvent.unit,
        country: savedEvent.country,
        currency: savedEvent.currency,
        scheduledAt: savedEvent.scheduledAt.toISOString(),
        releasedAt: new Date().toISOString(),
        macroTrend,
        surprise,
      });
    }

    return {
      success: true,
      eventId: savedEvent.id,
      name: savedEvent.name,
      actual: savedEvent.actual,
      forecast: savedEvent.forecast,
      macroTrend,
      surprise,
      pipelineTriggered: Boolean(this.eventBus),
    };
  }
}

