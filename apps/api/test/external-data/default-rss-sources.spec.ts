import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTERNAL_DATA_SOURCES } from '../../src/modules/external-data/application/jobs/external-data-scheduler.service';

describe('default RSS source coverage', () => {
  it('seeds diversified editorial and official primary sources', () => {
    const enabledRss = DEFAULT_EXTERNAL_DATA_SOURCES.filter((source) =>
      source.provider === 'GENERIC_RSS' && source.isEnabled,
    );
    const domains = enabledRss.map((source) => source.baseDomain);

    expect(enabledRss.length).toBeGreaterThanOrEqual(10);
    expect(domains).toEqual(expect.arrayContaining([
      'coindesk.com', 'decrypt.co', 'blockworks.com', 'dlnews.com',
      'sec.gov', 'federalreserve.gov', 'cftc.gov',
    ]));
    expect(new Set(enabledRss.map((source) => source.feedUrl)).size).toBe(enabledRss.length);
  });
});
