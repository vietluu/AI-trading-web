import { Injectable, Optional } from '@nestjs/common';
import { MacroImportConfirmRequest, MacroImportPreviewResponse } from '@platform/shared';
import { PrismaService } from '../../../../database/prisma.service';
import { ManualMacroAdapter } from '../../infrastructure/providers/macro/manual-macro.adapter';
import { ExternalDataEventBus } from './external-data-event-bus.service';
import { scoreMacroTrend } from '../../../agents/domain/definitions/macro-analyst.definition';

@Injectable()
export class MacroImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manualMacroAdapter: ManualMacroAdapter,
    @Optional() private readonly eventBus?: ExternalDataEventBus,
  ) {}

  previewImport(content: string, fileFormat: 'csv' | 'json'): MacroImportPreviewResponse {
    return this.manualMacroAdapter.parseAndValidateInput(content, fileFormat);
  }

  async confirmImport(userId: string, request: MacroImportConfirmRequest) {
    const { fileName, fileFormat, items } = request;

    let acceptedCount = 0;
    let rejectedCount = 0;
    const errors: { name: string; scheduledAt: string; error: string }[] = [];

    for (const item of items) {
      try {
        const scheduledAtDate = new Date(item.scheduledAt);
        if (isNaN(scheduledAtDate.getTime())) {
          rejectedCount++;
          errors.push({ name: item.name, scheduledAt: item.scheduledAt, error: 'Invalid scheduledAt date' });
          continue;
        }

        // Upsert macroeconomic event
        const savedEvent = await this.prisma.macroEconomicEvent.upsert({
          where: {
            provider_name_scheduledAt: {
              provider: 'MANUAL_MACRO',
              name: item.name,
              scheduledAt: scheduledAtDate,
            },
          },
          create: {
            provider: 'MANUAL_MACRO',
            name: item.name,
            country: item.country || null,
            currency: item.currency || null,
            category: item.category as any,
            importance: item.importance as any,
            scheduledAt: scheduledAtDate,
            actual: item.actual || null,
            forecast: item.forecast || null,
            previous: item.previous || null,
            unit: item.unit || null,
            status: (item.status as any) || 'SCHEDULED',
            sourceUrl: item.sourceUrl || null,
          },
          update: {
            country: item.country || null,
            currency: item.currency || null,
            category: item.category as any,
            importance: item.importance as any,
            actual: item.actual || null,
            forecast: item.forecast || null,
            previous: item.previous || null,
            unit: item.unit || null,
            status: (item.status as any) || 'SCHEDULED',
            sourceUrl: item.sourceUrl || null,
          },
        });

        if (item.actual && this.eventBus) {
          const macroTrend = scoreMacroTrend([{
            name: savedEvent.name,
            importance: savedEvent.importance,
            actual: savedEvent.actual,
            forecast: savedEvent.forecast,
          }]);
          const actualNum = parseFloat(item.actual);
          const forecastNum = item.forecast ? parseFloat(item.forecast) : NaN;
          const surprise = Number.isFinite(actualNum) && Number.isFinite(forecastNum)
            ? actualNum - forecastNum
            : null;

          this.eventBus.emitMacroRelease({
            id: savedEvent.id,
            name: savedEvent.name,
            category: savedEvent.category,
            importance: savedEvent.importance,
            actual: item.actual,
            forecast: item.forecast ?? null,
            previous: item.previous ?? null,
            unit: item.unit ?? null,
            country: item.country ?? null,
            currency: item.currency ?? null,
            scheduledAt: savedEvent.scheduledAt.toISOString(),
            releasedAt: new Date().toISOString(),
            macroTrend,
            surprise,
          });
        }

        acceptedCount++;
      } catch (err: any) {
        rejectedCount++;
        errors.push({ name: item.name, scheduledAt: item.scheduledAt, error: err.message });
      }
    }

    // Save MacroImportRun audit record
    const importRun = await this.prisma.macroImportRun.create({
      data: {
        userId,
        fileName,
        fileFormat,
        totalRows: items.length,
        acceptedRows: acceptedCount,
        rejectedRows: rejectedCount,
        errors: errors.length > 0 ? (errors as any) : undefined,
      },
    });

    return {
      importRunId: importRun.id,
      totalRows: items.length,
      acceptedRows: acceptedCount,
      rejectedRows: rejectedCount,
      createdAt: importRun.createdAt.toISOString(),
    };
  }
}
