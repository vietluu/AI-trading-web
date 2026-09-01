import { describe, expect, it } from 'vitest';
import { MACRO_ANALYST_DEFINITION } from '../src/modules/agents/domain/definitions/macro-analyst.definition';

const makeToolData = (events: object[]) => ({
  'macro.events.list': { events },
});

describe('MACRO_ANALYST_DEFINITION - macroTrend scoring', () => {
  it('should return RISK_OFF when CPI actual > forecast (hawkish surprise)', () => {
    const result = MACRO_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData([{ name: 'CPI YoY', importance: 'HIGH', actual: '4.2', forecast: '3.8', previous: '3.9', scheduledAt: new Date().toISOString() }]),
      [],
    );
    expect(result?.macroTrend).toBe('RISK_OFF');
  });

  it('should return RISK_ON when FOMC actual < forecast (dovish surprise — rate cut)', () => {
    const result = MACRO_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData([{ name: 'FOMC Interest Rate Decision', importance: 'HIGH', actual: '5.00', forecast: '5.25', previous: '5.25', scheduledAt: new Date().toISOString() }]),
      [],
    );
    expect(result?.macroTrend).toBe('RISK_ON');
  });

  it('should return NEUTRAL when only LOW-importance events exist', () => {
    const result = MACRO_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData([{ name: 'Initial Jobless Claims', importance: 'LOW', actual: '210K', forecast: '215K', scheduledAt: new Date().toISOString() }]),
      [],
    );
    expect(result?.macroTrend).toBe('NEUTRAL');
  });

  it('should return NEUTRAL when events list is empty', () => {
    const result = MACRO_ANALYST_DEFINITION.buildDeterministicOutput!(makeToolData([]), []);
    expect(result?.macroTrend).toBe('NEUTRAL');
  });

  it('should return RISK_ON when GDP actual > forecast (economic expansion)', () => {
    const result = MACRO_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData([
        { name: 'GDP Growth Rate QoQ', importance: 'HIGH', actual: '3.0', forecast: '2.5', scheduledAt: new Date().toISOString() },
        { name: 'Gross Domestic Product YoY', importance: 'HIGH', actual: '3.2', forecast: '2.8', scheduledAt: new Date().toISOString() },
      ]),
      [],
    );
    expect(result?.macroTrend).toBe('RISK_ON');
  });

  it('should return RISK_OFF when Nonfarm Payrolls misses forecast by > 20%', () => {
    const result = MACRO_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData([
        { name: 'Nonfarm Payrolls', importance: 'HIGH', actual: '100', forecast: '180', scheduledAt: new Date().toISOString() },
        { name: 'Private Payrolls', importance: 'HIGH', actual: '90', forecast: '150', scheduledAt: new Date().toISOString() },
      ]),
      [],
    );
    expect(result?.macroTrend).toBe('RISK_OFF');
  });
});
