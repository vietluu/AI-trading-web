import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { URL } from 'url';

@Injectable()
export class UrlCanonicalizer {
  private readonly trackingParameters = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'fbclid',
    'gclid',
    'ref',
    'source',
    'mc_cid',
    'mc_eid',
    '_hsenc',
    '_hsmi',
  ]);

  canonicalize(rawUrl: string): { canonicalUrl: string; urlHash: string } {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('URL string must not be empty');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new Error(`Invalid URL structure: ${rawUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid URL scheme: ${parsed.protocol}`);
    }

    // 1. Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // 2. Remove fragment / hash
    parsed.hash = '';

    // 3. Remove known tracking query parameters
    const params = new URLSearchParams(parsed.search);
    for (const key of Array.from(params.keys())) {
      if (this.trackingParameters.has(key.toLowerCase())) {
        params.delete(key);
      }
    }

    // Sort query parameters deterministically
    params.sort();
    parsed.search = params.toString() ? `?${params.toString()}` : '';

    // 4. Normalize trailing slash on path (keep root slash)
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    const canonicalUrl = parsed.toString();
    const urlHash = crypto.createHash('sha256').update(canonicalUrl).digest('hex');

    return { canonicalUrl, urlHash };
  }

  normalizeTitle(title: string): { normalizedTitle: string; titleHash: string } {
    if (!title) return { normalizedTitle: '', titleHash: '' };

    const normalizedTitle = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip diacritical marks
      .replace(/[^\w\s]/gi, ' ') // replace punctuation with spaces
      .replace(/\s+/g, ' ') // normalize whitespace
      .trim();

    const titleHash = crypto.createHash('sha256').update(normalizedTitle).digest('hex');
    return { normalizedTitle, titleHash };
  }
}
