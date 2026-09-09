import type {
  AnticipatoryMarketSnapshot,
  EvidenceRef,
  ThesisValidationReasonCode,
  ThesisValidationResult,
  TradeThesis,
} from '@platform/shared';
import { resolveSnapshotPath } from '@platform/shared';

export interface TradeThesisValidatorOptions {
  now?: Date | string | number;
  minNetR?: number;
}

const DEFAULT_MIN_NET_R = 1.0;
const FLOAT_EPSILON = 1e-6;

function getSnapshotValue(snapshot: unknown, path: string): unknown {
  const segments = path.split('.');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return undefined;
  }

  let current: unknown = snapshot;
  for (const segment of segments) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(.*)$/u.exec(segment);
    if (match === null) return undefined;

    const prop = match[1];
    const indexSuffix = match[2];
    if (
      prop === undefined ||
      indexSuffix === undefined ||
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, prop)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[prop];

    const indexPattern = /\[(\d+)\]/gu;
    let consumed = '';
    for (const indexMatch of indexSuffix.matchAll(indexPattern)) {
      consumed += indexMatch[0];
      if (!Array.isArray(current)) return undefined;
      const index = Number(indexMatch[1]);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    }
    if (consumed !== indexSuffix) return undefined;
  }

  return current;
}

function validateEvidenceRef(
  ref: EvidenceRef,
  snapshot: AnticipatoryMarketSnapshot,
  cutoffMs: number,
  reasonCodes: ThesisValidationReasonCode[],
  reasons: string[],
): void {
  if (!resolveSnapshotPath(snapshot, ref.snapshotField)) {
    reasonCodes.push('EVIDENCE_REF_INVALID');
    reasons.push(
      `Evidence ref cites absent snapshot field "${ref.snapshotField}"`,
    );
    return;
  }

  const resolvedValue = getSnapshotValue(snapshot, ref.snapshotField);
  if (
    resolvedValue !== null &&
    typeof resolvedValue === 'object' &&
    (resolvedValue as Record<string, unknown>).coverage === 'UNAVAILABLE'
  ) {
    reasonCodes.push('EVIDENCE_REF_INVALID');
    reasons.push(
      `Evidence ref cites UNAVAILABLE snapshot field "${ref.snapshotField}"`,
    );
    return;
  }

  const refTimestampMs = Date.parse(ref.sourceTimestamp);
  if (isNaN(refTimestampMs) || refTimestampMs > cutoffMs) {
    reasonCodes.push('EVIDENCE_REF_INVALID');
    reasons.push(
      `Evidence ref timestamp (${ref.sourceTimestamp}) is after snapshot cutoff (${snapshot.sourceDataCutoff})`,
    );
  }

  if (ref.calculationVersion !== snapshot.calculationVersion) {
    reasonCodes.push('EVIDENCE_REF_INVALID');
    reasons.push(
      `Evidence ref calculationVersion (${ref.calculationVersion}) does not match snapshot calculationVersion (${snapshot.calculationVersion})`,
    );
  }
}

/**
 * Pure, deterministic validator for TradeThesis contracts.
 * Evaluates freshness, evidence references, geometry, protection, net R policy,
 * and chase limits against an AnticipatoryMarketSnapshot.
 */
export function validateTradeThesis(
  thesis: TradeThesis,
  snapshot: AnticipatoryMarketSnapshot,
  options?: TradeThesisValidatorOptions,
): ThesisValidationResult {
  const reasonCodes: ThesisValidationReasonCode[] = [];
  const reasons: string[] = [];

  const isActionable =
    thesis.direction !== 'WAIT' && thesis.setup !== 'NO_TRADE';

  const cutoffMs = Date.parse(snapshot.sourceDataCutoff);
  const evaluationTimeMs =
    options?.now !== undefined
      ? new Date(options.now).getTime()
      : cutoffMs;

  // 1. Freshness / Expiry validation (THESIS_STALE)
  const expiresAtMs = Date.parse(thesis.expiresAt);
  if (isNaN(expiresAtMs) || expiresAtMs <= evaluationTimeMs) {
    reasonCodes.push('THESIS_STALE');
    reasons.push(
      `Thesis expired at ${thesis.expiresAt} (evaluation cutoff: ${new Date(evaluationTimeMs).toISOString()})`,
    );
  }

  // 2. Evidence references validation (EVIDENCE_REF_INVALID)
  for (const ref of thesis.evidenceFor) {
    validateEvidenceRef(ref, snapshot, cutoffMs, reasonCodes, reasons);
  }
  for (const ref of thesis.evidenceAgainst) {
    validateEvidenceRef(ref, snapshot, cutoffMs, reasonCodes, reasons);
  }

  // 3. Protection requirements (PROTECTION_REQUIRED)
  if (isActionable) {
    if (thesis.invalidation === null) {
      reasonCodes.push('PROTECTION_REQUIRED');
      reasons.push(
        `Actionable ${thesis.direction} thesis requires a structural invalidation specification`,
      );
    }
    if (thesis.stopLoss === null) {
      reasonCodes.push('PROTECTION_REQUIRED');
      reasons.push(
        `Actionable ${thesis.direction} thesis requires an explicit stop loss`,
      );
    }
  }

  // 4. Geometry validation (GEOMETRY_INVALID)
  if (thesis.entryZone !== null) {
    if (thesis.entryZone.lower > thesis.entryZone.upper) {
      reasonCodes.push('GEOMETRY_INVALID');
      reasons.push(
        `Entry zone lower (${thesis.entryZone.lower}) must not exceed upper (${thesis.entryZone.upper})`,
      );
    }
  }

  if (thesis.targets.length > 0) {
    const fractionSum = thesis.targets.reduce(
      (sum, target) => sum + target.fraction,
      0,
    );
    if (fractionSum > 1.0 + FLOAT_EPSILON) {
      reasonCodes.push('GEOMETRY_INVALID');
      reasons.push(
        `Target fractions sum to ${fractionSum.toFixed(4)}, which exceeds 1.0`,
      );
    }
  }

  if (isActionable) {
    if (thesis.entryZone === null) {
      reasonCodes.push('GEOMETRY_INVALID');
      reasons.push(
        `Actionable ${thesis.direction} thesis requires a non-null entry zone`,
      );
    }

    if (thesis.targets.length === 0) {
      reasonCodes.push('GEOMETRY_INVALID');
      reasons.push(
        `Actionable ${thesis.direction} thesis must specify at least one target`,
      );
    }

    if (thesis.direction === 'LONG') {
      if (
        thesis.entryZone !== null &&
        thesis.stopLoss !== null &&
        thesis.stopLoss >= thesis.entryZone.lower
      ) {
        reasonCodes.push('GEOMETRY_INVALID');
        reasons.push(
          `LONG stopLoss (${thesis.stopLoss}) must be strictly below entryZone.lower (${thesis.entryZone.lower})`,
        );
      }

      if (thesis.entryZone !== null) {
        for (const target of thesis.targets) {
          if (target.price <= thesis.entryZone.lower) {
            reasonCodes.push('GEOMETRY_INVALID');
            reasons.push(
              `LONG target price (${target.price}) must be above entryZone.lower (${thesis.entryZone.lower})`,
            );
          }
        }
      }
    } else if (thesis.direction === 'SHORT') {
      if (
        thesis.entryZone !== null &&
        thesis.stopLoss !== null &&
        thesis.stopLoss <= thesis.entryZone.upper
      ) {
        reasonCodes.push('GEOMETRY_INVALID');
        reasons.push(
          `SHORT stopLoss (${thesis.stopLoss}) must be strictly above entryZone.upper (${thesis.entryZone.upper})`,
        );
      }

      if (thesis.entryZone !== null) {
        for (const target of thesis.targets) {
          if (target.price >= thesis.entryZone.upper) {
            reasonCodes.push('GEOMETRY_INVALID');
            reasons.push(
              `SHORT target price (${target.price}) must be below entryZone.upper (${thesis.entryZone.upper})`,
            );
          }
        }
      }
    }
  }

  // 5. Net R policy validation (NET_R_TOO_LOW)
  if (isActionable) {
    const minNetR = options?.minNetR ?? DEFAULT_MIN_NET_R;
    if (thesis.expectedNetR === null || thesis.expectedNetR < minNetR) {
      reasonCodes.push('NET_R_TOO_LOW');
      reasons.push(
        `Expected net R (${thesis.expectedNetR ?? 'null'}) is below policy threshold (${minNetR})`,
      );
    }
  }

  // 6. Chase distance and state validation (ENTRY_TOO_LATE)
  if (thesis.state === 'TOO_LATE') {
    reasonCodes.push('ENTRY_TOO_LATE');
    reasons.push('Thesis state is explicitly marked as TOO_LATE');
  }

  if (
    isActionable &&
    thesis.entryZone !== null &&
    snapshot.execution.coverage === 'AVAILABLE' &&
    snapshot.volatility.coverage === 'AVAILABLE'
  ) {
    const currentPrice = snapshot.execution.currentPrice;
    const atr = snapshot.volatility.atr;
    if (atr > 0) {
      if (
        thesis.direction === 'LONG' &&
        currentPrice > thesis.entryZone.upper
      ) {
        const chaseAtr = (currentPrice - thesis.entryZone.upper) / atr;
        if (chaseAtr > thesis.maximumChaseDistanceAtr + FLOAT_EPSILON) {
          reasonCodes.push('ENTRY_TOO_LATE');
          reasons.push(
            `Current price (${currentPrice}) is ${chaseAtr.toFixed(2)} ATR above entry zone upper (${thesis.entryZone.upper}), exceeding max chase distance (${thesis.maximumChaseDistanceAtr} ATR)`,
          );
        }
      } else if (
        thesis.direction === 'SHORT' &&
        currentPrice < thesis.entryZone.lower
      ) {
        const chaseAtr = (thesis.entryZone.lower - currentPrice) / atr;
        if (chaseAtr > thesis.maximumChaseDistanceAtr + FLOAT_EPSILON) {
          reasonCodes.push('ENTRY_TOO_LATE');
          reasons.push(
            `Current price (${currentPrice}) is ${chaseAtr.toFixed(2)} ATR below entry zone lower (${thesis.entryZone.lower}), exceeding max chase distance (${thesis.maximumChaseDistanceAtr} ATR)`,
          );
        }
      }
    }
  }

  const uniqueReasonCodes = Array.from(new Set(reasonCodes));
  const isValid = uniqueReasonCodes.length === 0;

  return {
    valid: isValid,
    status: isValid ? 'VALID' : 'INVALID',
    reasonCodes: uniqueReasonCodes,
    reasons,
  };
}
