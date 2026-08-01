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
    let rows: unknown[] = [];
    if (fileFormat === 'json') {
      try {
        const parsed = JSON.parse(content);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new ExternalDataError({
          message: `Invalid JSON format: ${errorMsg}`,
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
      } catch (err: unknown) {
        invalidCount++;
        let errMsg = err instanceof Error ? err.message : String(err);
        if (typeof err === 'object' && err !== null && 'errors' in err && Array.isArray((err as any).errors)) {
          const zodErrors = (err as any).errors;
          errMsg = zodErrors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
        }
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

  private normalizeRawMacroRow(row: unknown): Record<string, unknown> {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Row is not an object');
    }

    const r = row as Record<string, unknown>;

    // Map common CSV/JSON column name variations
    const name = typeof r.name === 'string' ? r.name : typeof r.Name === 'string' ? r.Name : typeof r.event === 'string' ? r.event : typeof r.Event === 'string' ? r.Event : '';
    const country = typeof r.country === 'string' ? r.country : typeof r.Country === 'string' ? r.Country : typeof r.region === 'string' ? r.region : '';
    const currency = typeof r.currency === 'string' ? r.currency : typeof r.Currency === 'string' ? r.Currency : '';
    const categoryRaw = String(typeof r.category === 'string' ? r.category : typeof r.Category === 'string' ? r.Category : 'OTHER').toUpperCase();
    const importanceRaw = String(typeof r.importance === 'string' ? r.importance : typeof r.Importance === 'string' ? r.Importance : 'MEDIUM').toUpperCase();
    const scheduledAtRaw = typeof r.scheduledAt === 'string' || typeof r.scheduledAt === 'number' ? r.scheduledAt : typeof r.scheduled_at === 'string' || typeof r.scheduled_at === 'number' ? r.scheduled_at : typeof r.date === 'string' || typeof r.date === 'number' ? r.date : typeof r.Date === 'string' || typeof r.Date === 'number' ? r.Date : typeof r.time === 'string' || typeof r.time === 'number' ? r.time : undefined;

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
      const parsedDate = new Date(String(scheduledAtRaw));
      if (!isNaN(parsedDate.getTime())) {
        scheduledAt = parsedDate.toISOString();
      } else {
        throw new Error(`Invalid scheduledAt date string: ${String(scheduledAtRaw)}`);
      }
    }

    const sourceUrlVal = r.sourceUrl || r.source_url;

    return {
      name: name.trim(),
      country: country ? country.trim() : undefined,
      currency: currency ? currency.trim() : undefined,
      category,
      importance,
      scheduledAt,
      actual: r.actual != null ? (typeof r.actual === 'string' || typeof r.actual === 'number' ? String(r.actual) : '').trim() : undefined,
      forecast: r.forecast != null ? (typeof r.forecast === 'string' || typeof r.forecast === 'number' ? String(r.forecast) : '').trim() : undefined,
      previous: r.previous != null ? (typeof r.previous === 'string' || typeof r.previous === 'number' ? String(r.previous) : '').trim() : undefined,
      unit: r.unit != null ? (typeof r.unit === 'string' || typeof r.unit === 'number' ? String(r.unit) : '').trim() : undefined,
      status: typeof r.status === 'string' ? r.status : 'SCHEDULED',
      sourceUrl: typeof sourceUrlVal === 'string' ? sourceUrlVal : undefined,
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
    return Promise.resolve({
      provider: 'MANUAL_MACRO',
      status: 'HEALTHY',
      latencyMs: 0,
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
    });
  }
}
