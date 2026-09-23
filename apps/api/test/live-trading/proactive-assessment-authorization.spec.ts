import { describe, expect, it, vi } from 'vitest';
import { LiveTradingService } from '../../src/modules/live-trading/application/live-trading.service';
import { createBaseSnapshot, createValidLongThesis } from '../helpers/thesis-fixture';

function fixture(mode: string, environment = 'DEMO') {
  const assessment = { id: 'assessment-1', userId: 'user-1', approved: true, positionSize: 0.01, leverage: 1, decision: 'LONG', connectionId: 'demo', createdAt: new Date(),
    executionAuthorization: { kind: 'PROACTIVE', mode, requiredEnvironment: 'DEMO', connectionId: 'demo', thesisId: 'thesis-1', opportunityId: 'opportunity-1', snapshot: createBaseSnapshot(), thesis: createValidLongThesis() } };
  const submit = vi.fn();
  const service = new LiveTradingService({ riskAssessment: { findFirst: () => Promise.resolve(assessment), findUnique: () => Promise.resolve(assessment) }, liveOrder: { findUnique: () => Promise.resolve(null) } } as never,
    { get: () => Promise.resolve({ id: 'demo', environment, isEnabled: true, isVerified: true }), list: () => Promise.resolve([{ id: 'demo', environment, isEnabled: true, isVerified: true }]), placeOrder: submit } as never,
    { values: { mode: 'DEMO', runtimeEnabled: true, approvalTtlMs: 60000 }, assertExecutionAllowed: () => undefined } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never);
  return { service, submit };
}

describe('durable proactive assessment authorization', () => {
  it.each(['OBSERVE', 'SHADOW'])('public execute cannot consume a %s assessment', async (mode) => {
    const { service, submit } = fixture(mode);
    await expect(service.execute('user-1', { connectionId: 'demo', riskAssessmentId: 'assessment-1' } as never, {}, { skipPreExecutionSync: true })).rejects.toThrow('PROACTIVE_EXECUTION_NOT_AUTHORIZED');
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(['OBSERVE', 'SHADOW'])('executePipeline cannot consume a %s assessment without runner options', async (mode) => {
    const { service, submit } = fixture(mode);
    expect(await service.executePipeline('user-1', 'run-1')).toMatchObject({ outcome: 'PROACTIVE_EXECUTION_NOT_AUTHORIZED' });
    expect(submit).not.toHaveBeenCalled();
  });
  it('public execute rejects a production connection for a DEMO assessment', async () => {
    const { service } = fixture('DEMO', 'PRODUCTION');
    await expect(service.execute('user-1', { connectionId: 'demo', riskAssessmentId: 'assessment-1' } as never, {}, { skipPreExecutionSync: true })).rejects.toThrow('PROACTIVE_EXECUTION_NOT_AUTHORIZED');
  });
});
