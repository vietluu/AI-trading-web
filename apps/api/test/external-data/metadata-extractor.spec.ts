import { describe, expect, it } from 'vitest';
import { MetadataExtractor } from '../../src/modules/external-data/application/services/metadata-extractor.service';

describe('MetadataExtractor', () => {
  const extractor = new MetadataExtractor();

  it('extracts crypto symbols and maps to BASE-QUOTE format', () => {
    const title = 'Bitcoin (BTC) and Ethereum (ETH) Surge After SEC Decision';
    const metadata = extractor.extractMetadata(title);

    expect(metadata.symbols).toContain('BTC-USDT');
    expect(metadata.symbols).toContain('ETH-USDT');
    expect(metadata.topics).toContain('regulation');
  });

  it('prevents false positives for common English words like LINK and ONE', () => {
    const title = 'There is one link between traditional finance and crypto';
    const metadata = extractor.extractMetadata(title);

    // Should NOT extract LINK-USDT or ONE-USDT without explicit cashtag or pair context
    expect(metadata.symbols).not.toContain('LINK-USDT');
    expect(metadata.symbols).not.toContain('ONE-USDT');
  });

  it('extracts LINK when explicit cashtag $LINK or trading pair LINK/USDT is used', () => {
    const title = 'Chainlink ($LINK) Rallies Following New Oracle Integration';
    const metadata = extractor.extractMetadata(title);

    expect(metadata.symbols).toContain('LINK-USDT');
    expect(metadata.topics).toContain('oracle');
  });

  it('extracts known financial and regulatory entities', () => {
    const title = 'Binance CEO Meets SEC Chair Gary Gensler Regarding Compliance';
    const metadata = extractor.extractMetadata(title);

    const entityNames = metadata.entities.map((e) => e.entity);
    expect(entityNames).toContain('Binance');
    expect(entityNames).toContain('SEC');
  });
});
