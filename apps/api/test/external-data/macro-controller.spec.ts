import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MacroController } from '../../src/modules/external-data/presentation/controllers/macro.controller';

describe('MacroController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to current and upcoming events instead of the oldest archive page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T08:00:00.000Z'));
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new MacroController(
      { macroEconomicEvent: { count, findMany } } as never,
      {} as never,
    );

    await controller.getMacroEvents();

    const expectedWhere = {
      scheduledAt: { gte: new Date('2026-08-17T08:00:00.000Z') },
    };
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        orderBy: { scheduledAt: 'asc' },
      }),
    );
  });

  it('preserves explicit historical ranges and rejects invalid dates', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new MacroController(
      { macroEconomicEvent: { count, findMany } } as never,
      {} as never,
    );

    await controller.getMacroEvents(
      undefined,
      undefined,
      undefined,
      undefined,
      '2025-01-01',
      '2025-12-31',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scheduledAt: {
            gte: new Date('2025-01-01'),
            lte: new Date('2025-12-31'),
          },
        },
      }),
    );

    await expect(
      controller.getMacroEvents(
        undefined,
        undefined,
        undefined,
        undefined,
        'not-a-date',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
