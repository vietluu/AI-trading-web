import { describe, expect, it } from 'vitest';
import { UrlCanonicalizer } from '../../src/modules/external-data/application/services/url-canonicalizer.service';

describe('UrlCanonicalizer', () => {
  const canonicalizer = new UrlCanonicalizer();

  it('lowercases hostname and strips tracking parameters', () => {
    const raw = 'HTTPS://WWW.CoinDesk.COM/news/article-1/?utm_source=twitter&utm_medium=social&ref=123#header';
    const { canonicalUrl, urlHash } = canonicalizer.canonicalize(raw);

    expect(canonicalUrl).toBe('https://www.coindesk.com/news/article-1');
    expect(urlHash).toHaveLength(64); // SHA256 hex string
  });

  it('normalizes trailing slashes on non-root paths', () => {
    const raw = 'https://cointelegraph.com/news/bitcoin-breaks-record/';
    const { canonicalUrl } = canonicalizer.canonicalize(raw);

    expect(canonicalUrl).toBe('https://cointelegraph.com/news/bitcoin-breaks-record');
  });

  it('preserves meaningful non-tracking query parameters', () => {
    const raw = 'https://example.com/search?q=crypto&page=2&utm_source=feed';
    const { canonicalUrl } = canonicalizer.canonicalize(raw);

    expect(canonicalUrl).toBe('https://example.com/search?page=2&q=crypto');
  });

  it('normalizes title into a clean title hash', () => {
    const rawTitle = 'Bitcoin Hits $100K! (New All-Time High)';
    const { normalizedTitle, titleHash } = canonicalizer.normalizeTitle(rawTitle);

    expect(normalizedTitle).toBe('bitcoin hits 100k new all time high');
    expect(titleHash).toHaveLength(64);
  });

  it('rejects invalid schemes or malformed URLs', () => {
    expect(() => canonicalizer.canonicalize('ftp://example.com/file')).toThrow('Invalid URL scheme');
    expect(() => canonicalizer.canonicalize('not-a-url')).toThrow('Invalid URL structure');
  });
});
