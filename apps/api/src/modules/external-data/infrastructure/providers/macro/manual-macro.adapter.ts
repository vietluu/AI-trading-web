import { Injectable } from '@nestjs/common';
import {
  MacroEventCategory,
  MacroImportance,
  MacroImportItem,
  macroImportItemSchema,
} from '@platform/shared';
import {
  MacroEventSourceAdapter,
  MacroFetchContext,
  ProviderHealth,
  RawMacroEvent,
} from '../../../domain/adapters/source-adapter.contracts';
import { ExternalDataError, ExternalDataErrorCode } from '../../../domain/errors/external-data.error';

export interface MacroParsePreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewItems: MacroImportItem[];
  errors: { row: number; message: string }[];
}

@Injectable()
export class ManualMacroAdapter implements MacroEventSourceAdapter {
  readonly sourceId: string = 'manual-macro-adapter';
  readonly provider = 'MANUAL_MACRO' as const;

  async fetchEvents(_context: MacroFetchContext): Promise<RawMacroEvent[]> {
    return [];
  }

  parseAndValidateInput(
    content: string,
    fileFormat: 'csv' | 'json',
  ): MacroParsePreviewResult {
    let rows: any[] = [];
    if (fileFormat === 'json') {
      try {
        const parsed = JSON.parse(content);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch (err: any) {
        throw new ExternalDataError({
          message: `Invalid JSON format: ${err.message}`,
          code: ExternalDataErrorCode.IMPORT_VALIDATION_FAILED,
          provider: 'MANUAL_MACRO',
          retryable: false,
          statusCode: 400,
        });
      }
    } else {
      // CSV parsing
      rows = this.parseCsvString(content);
    }

    const previewItems: MacroImportItem[] = [];
    const errors: { row: number; message: string }[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i];
      const rowNum = i + 1;

      try {
        const normalized = this.normalizeRawMacroRow(rawRow);
        const validated = macroImportItemSchema.parse(normalized);
        previewItems.push(validated);
        validCount++;
      } catch (err: any) {
        invalidCount++;
        const errMsg = err.errors ? err.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ') : err.message;
        errors.push({ row: rowNum, message: errMsg });
      }
    }

    return {
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      previewItems,
      errors,
    };
  }

  private normalizeRawMacroRow(row: any): Record<string, any> {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Row is not an object');
    }

    // Map common CSV/JSON column name variations
    const name = row.name || row.Name || row.event || row.Event || '';
    const country = row.country || row.Country || row.region || '';
    const currency = row.currency || row.Currency || '';
    const categoryRaw = (row.category || row.Category || 'OTHER').toUpperCase();
    const importanceRaw = (row.importance || row.Importance || 'MEDIUM').toUpperCase();
    const scheduledAtRaw = row.scheduledAt || row.scheduled_at || row.date || row.Date || row.time;

    let category: MacroEventCategory = 'OTHER';
    if (['CPI', 'PPI', 'GDP', 'UNEMPLOYMENT', 'NONFARM_PAYROLLS', 'INTEREST_RATE_DECISION', 'CENTRAL_BANK_SPEECH', 'FOMC', 'RETAIL_SALES', 'PMI', 'DOLLAR_INDEX', 'TREASURY_AUCTION'].includes(categoryRaw)) {
      category = categoryRaw as MacroEventCategory;
    }

    let importance: MacroImportance = 'MEDIUM';
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(importanceRaw)) {
      importance = importanceRaw as MacroImportance;
    }

    let scheduledAt = new Date().toISOString();
    if (scheduledAtRaw) {
      const parsedDate = new Date(scheduledAtRaw);
      if (!isNaN(parsedDate.getTime())) {
        scheduledAt = parsedDate.toISOString();
      } else {
        throw new Error(`Invalid scheduledAt date string: ${scheduledAtRaw}`);
      }
    }

    return {
      name: String(name).trim(),
      country: country ? String(country).trim() : undefined,
      currency: currency ? String(currency).trim() : undefined,
      category,
      importance,
      scheduledAt,
      actual: row.actual != null ? String(row.actual).trim() : undefined,
      forecast: row.forecast != null ? String(row.forecast).trim() : undefined,
      previous: row.previous != null ? String(row.previous).trim() : undefined,
      unit: row.unit != null ? String(row.unit).trim() : undefined,
      status: row.status || 'SCHEDULED',
      sourceUrl: row.sourceUrl || row.source_url || undefined,
    };
  }

  private parseCsvString(csvText: string): Record<string, string>[] {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const firstLine = lines[0] || '';
    const headers = this.parseCsvLine(firstLine);
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const lineStr = lines[i] || '';
      const values = this.parseCsvLine(lineStr);
      if (values.length === 0) continue;

      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h.trim()] = values[idx] ? values[idx].trim() : '';
      });
      results.push(obj);
    }

    return results;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: 'MANUAL_MACRO' as any,
      status: 'HEALTHY',
      latencyMs: 0,
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
    };
  }
}
