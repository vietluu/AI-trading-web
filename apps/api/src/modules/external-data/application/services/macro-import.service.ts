import { Injectable } from '@nestjs/common';
import { MacroImportConfirmRequest, MacroImportPreviewResponse } from '@platform/shared';
import { PrismaService } from '../../../../database/prisma.service';
import { ManualMacroAdapter } from '../../infrastructure/providers/macro/manual-macro.adapter';

@Injectable()
export class MacroImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manualMacroAdapter: ManualMacroAdapter,
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
        await this.prisma.macroEconomicEvent.upsert({
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
