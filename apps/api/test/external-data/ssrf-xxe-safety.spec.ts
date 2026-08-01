import { describe, expect, it } from 'vitest';
import { ExternalHttpClient } from '../../src/modules/external-data/infrastructure/http/external-http-client';
import { GenericRssAdapter } from '../../src/modules/external-data/infrastructure/providers/rss/generic-rss.adapter';

describe('SSRF & XXE Security Protection', () => {
  const httpClient = new ExternalHttpClient();
  const rssAdapter = new GenericRssAdapter(httpClient);

  it('blocks SSRF targets resolving to localhost and private IPs', async () => {
    await expect(httpClient.validateSsrfTarget('localhost')).rejects.toThrow('Forbidden target hostname');
    await expect(httpClient.validateSsrfTarget('127.0.0.1')).rejects.toThrow('Host 127.0.0.1 resolves to blocked private/local IP');
    await expect(httpClient.validateSsrfTarget('169.254.169.254')).rejects.toThrow('Host 169.254.169.254 resolves to blocked private/local IP');
  });

  it('safely parses XML without resolving external entities (XXE safety)', () => {
    const maliciousXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <!DOCTYPE foo [  
      <!ELEMENT foo ANY >
      <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
    <rss version="2.0">
      <channel>
        <title>Safe Feed</title>
        <item>
          <title>Test Item &xxe;</title>
          <link>https://example.com/test</link>
        </item>
      </channel>
    </rss>`;

    expect(() => rssAdapter.parseFeedXml(maliciousXml)).toThrow();
  });
});
