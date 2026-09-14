import { describe, expect, it } from 'vitest';

import { selectBlockingGate } from '../../src/modules/pipeline/domain/gate-decision';

describe('selectBlockingGate', () => {
  it('selects the first blocking gate in execution order', () => {
    expect(
      selectBlockingGate([
        {
          stage: 'JUDGE',
          disposition: 'PASS',
          reasonCodes: ['VALID_EXACT_EVIDENCE'],
        },
        {
          stage: 'QUANT',
          disposition: 'BLOCK',
          reasonCodes: ['QUANT_ASSUMPTION_MISMATCH'],
        },
      ]),
    ).toEqual({ stage: 'QUANT', reason: 'QUANT_ASSUMPTION_MISMATCH' });
  });

  it('returns undefined when no gate blocks', () => {
    expect(
      selectBlockingGate([
        {
          stage: 'JUDGE',
          disposition: 'PASS',
          reasonCodes: ['VALID_EXACT_EVIDENCE'],
        },
      ]),
    ).toBeUndefined();
  });
});
