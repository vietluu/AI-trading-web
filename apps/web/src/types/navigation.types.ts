import type { Dictionary } from '@/lib/i18n/i18n.types';

export interface NavItem {
  key: keyof Dictionary['nav'];
  href: string;
}
