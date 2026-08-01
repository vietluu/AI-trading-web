import { describe, expect, it } from 'vitest';
import { ManualMacroAdapter } from '../../src/modules/external-data/infrastructure/providers/macro/manual-macro.adapter';

describe('ManualMacroAdapter (CSV/JSON Parser)', () => {
  const adapter = new ManualMacroAdapter();

  it('parses valid macro CSV content with preview mode', () => {
    const csvContent = `name,country,category,importance,scheduledAt,actual,forecast,previous
US CPI YoY,US,CPI,HIGH,2026-08-10T12:30:00Z,3.2%,3.1%,3.4%
FOMC Rate Decision,US,FOMC,CRITICAL,2026-09-18T18:00:00Z,,5.25%,5.25%`;

    const result = adapter.parseAndValidateInput(csvContent, 'csv');

    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(0);
    expect(result.previewItems[0]?.name).toBe('US CPI YoY');
    expect(result.previewItems[0]?.importance).toBe('HIGH');
  });

  it('parses valid macro JSON content', () => {
    const jsonContent = JSON.stringify([
      {
        name: 'US Nonfarm Payrolls',
        country: 'US',
        category: 'NONFARM_PAYROLLS',
        importance: 'HIGH',
        scheduledAt: '2026-08-07T12:30:00Z',
      },
    ]);

    const result = adapter.parseAndValidateInput(jsonContent, 'json');

    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
    expect(result.previewItems[0]?.name).toBe('US Nonfarm Payrolls');
  });

  it('captures invalid rows and reports line error messages', () => {
    const csvContent = `name,country,category,importance,scheduledAt
US CPI YoY,US,INVALID_CAT,HIGH,invalid-date`;

    const result = adapter.parseAndValidateInput(csvContent, 'csv');

    expect(result.totalRows).toBe(1);
    expect(result.invalidRows).toBe(1);
    expect(result.errors.length).toBe(1);
  });
});
