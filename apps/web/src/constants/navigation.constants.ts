import type { NavItem } from '@/types/navigation.types';

export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', href: '/' },
  { key: 'quantIntelligence', href: '/quant-intelligence' },
  { key: 'market', href: '/market' },
  { key: 'decision', href: '/decision' },
  { key: 'automation', href: '/pipeline' },
  { key: 'trading', href: '/live-trading' },
] as const;

export const MORE_NAV_ITEMS: readonly NavItem[] = [
  { key: 'research', href: '/research' },
  { key: 'factors', href: '/factors' },
  { key: 'strategyLab', href: '/strategy-lab' },
  { key: 'portfolioIntelligence', href: '/portfolio-intelligence' },
  { key: 'recommendations', href: '/recommendations' },
  { key: 'knowledge', href: '/knowledge' },
  { key: 'news', href: '/news' },
  { key: 'macro', href: '/macro' },
  { key: 'sentiment', href: '/sentiment' },
  { key: 'agentRuns', href: '/ai/agent-runs' },
  { key: 'performance', href: '/ai/performance' },
  { key: 'risk', href: '/ai/risk' },
  { key: 'portfolio', href: '/ai/portfolio' },
] as const;
