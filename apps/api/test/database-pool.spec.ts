import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';

const { construct } = vi.hoisted(() => ({ construct: vi.fn<(options: { datasourceUrl: string }) => void>() }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor(options: { datasourceUrl: string }) { construct(options); } } }));

function configuredUrl(url: string, size?: string): URL {
  new PrismaService({ getOrThrow: () => url, get: (key: string) => key === 'DATABASE_POOL_SIZE' ? size : undefined } as never);
  return new URL(construct.mock.lastCall![0].datasourceUrl);
}

describe('explicit per-process database pool', () => {
  it('does not inherit the CPU-derived three-connection pool on a small VM', () => {
    const url = configuredUrl('postgresql://user:pass@db/app?schema=public');
    expect(url.searchParams.get('connection_limit')).toBe('10');
    expect(url.searchParams.get('pool_timeout')).toBe('10');
    expect(url.searchParams.get('schema')).toBe('public');
  });
  it('preserves explicit URL limits and custom timeouts', () => {
    const url = configuredUrl('postgresql://user:pass@db/app?connection_limit=4&pool_timeout=7', '8');
    expect(url.searchParams.get('connection_limit')).toBe('4');
    expect(url.searchParams.get('pool_timeout')).toBe('7');
  });
  it('supports a bounded deployment-specific pool size', () => {
    expect(configuredUrl('postgresql://user:pass@db/app', '6').searchParams.get('connection_limit')).toBe('6');
  });
  it.each(['0', '-1', 'NaN', '1000'])('rejects invalid pool sizing %s', (size) => {
    expect(() => configuredUrl('postgresql://user:pass@db/app', size)).toThrow('DATABASE_POOL_SIZE');
  });
});
