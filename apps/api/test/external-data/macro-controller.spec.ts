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

  it('rejects live-release request without name or actual value', async () => {
    const controller = new MacroController({} as never, {} as never);
    await expect(
      controller.ingestLiveRelease({ name: '', actual: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ingests live CPI release, calculates RISK_ON when actual < forecast, and emits macro event', async () => {
    const emitMacroRelease = vi.fn();
    const eventBus = { emitMacroRelease };
    const scheduledAt = new Date('2026-09-11T12:30:00.000Z');
    const existingEvent = {
      id: 'macro-cpi-1',
      name: 'Consumer Price Index',
      category: 'CPI',
      importance: 'HIGH',
      country: 'US',
      currency: 'USD',
      scheduledAt,
      actual: null,
      forecast: '3.4',
      previous: '3.5',
    };
    const update = vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
      ...existingEvent,
      ...args.data,
      scheduledAt,
    }));
    const findFirst = vi.fn().mockResolvedValue(existingEvent);

    const controller = new MacroController(
      { macroEconomicEvent: { findFirst, update } } as never,
      {} as never,
      eventBus as never,
    );

    const result = await controller.ingestLiveRelease({
      name: 'Consumer Price Index',
      actual: '3.1',
      forecast: '3.4',
      scheduledAt: scheduledAt.toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.actual).toBe('3.1');
    expect(result.macroTrend).toBe('RISK_ON');
    expect(result.surprise).toBeCloseTo(-0.3);
    expect(result.pipelineTriggered).toBe(true);
    expect(emitMacroRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'macro-cpi-1',
        name: 'Consumer Price Index',
        actual: '3.1',
        macroTrend: 'RISK_ON',
      }),
    );
  });
});

