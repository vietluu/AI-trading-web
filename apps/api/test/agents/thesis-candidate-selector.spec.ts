import type { TradeThesis } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { selectTradeThesisCandidate } from "../../src/modules/agents/domain/thesis-candidate-selector";
import {
  createBaseSnapshot,
  createValidLongThesis,
  cutoff,
} from "../helpers/thesis-fixture";

function createValidShortThesis(): TradeThesis {
  return {
    ...createValidLongThesis(),
    direction: "SHORT",
    entryZone: { lower: 108_000, upper: 108_500 },
    trigger: [
      {
        type: "PRICE_BELOW",
        price: 108_250,
        description: "Break below the range boundary",
      },
    ],
    invalidation: {
      price: 108_700,
      reason: "Range resistance reclaim invalidates the short",
    },
    stopLoss: 109_000,
    targets: [{ price: 106_000, fraction: 1 }],
  };
}

describe("selectTradeThesisCandidate", () => {
  const snapshot = createBaseSnapshot();
  const now = new Date(cutoff);

  it("rejects an opposite AI thesis instead of executing against the baseline", () => {
    const result = selectTradeThesisCandidate({
      preferred: createValidShortThesis(),
      alternatives: [],
      baselineDirection: "LONG",
      snapshot,
      now,
    });

    expect(result).toMatchObject({
      selected: undefined,
      reason: "AI_BASELINE_DIRECTION_CONFLICT",
      candidateCount: 1,
      researchPreferredDirection: "SHORT",
      baselineDirection: "LONG",
      directionAgreement: false,
    });
  });

  it("selects a valid aligned alternative over an opposite preferred thesis", () => {
    const aligned = createValidLongThesis();
    const result = selectTradeThesisCandidate({
      preferred: createValidShortThesis(),
      alternatives: [aligned],
      baselineDirection: "LONG",
      snapshot,
      now,
    });

    expect(result.selected).toEqual(aligned);
    expect(result).toMatchObject({
      selectedCandidateIndex: 1,
      reason: "ALIGNED_CANDIDATE_SELECTED",
      directionAgreement: true,
    });
  });

  it("rejects every candidate when the deterministic baseline says WAIT", () => {
    const result = selectTradeThesisCandidate({
      preferred: createValidLongThesis(),
      alternatives: [],
      baselineDirection: "WAIT",
      snapshot,
      now,
    });

    expect(result).toMatchObject({
      selected: undefined,
      reason: "BASELINE_DECISION_WAIT",
      directionAgreement: false,
    });
  });

  it("returns the first stable validation reason when aligned candidates are invalid", () => {
    const invalid = { ...createValidLongThesis(), stopLoss: 108_100 };
    const result = selectTradeThesisCandidate({
      preferred: invalid,
      alternatives: [],
      baselineDirection: "LONG",
      snapshot,
      now,
    });

    expect(result).toMatchObject({
      selected: undefined,
      reason: "GEOMETRY_INVALID",
      directionAgreement: true,
    });
  });

  it("ranks aligned candidates by computed net R before LLM preference order", () => {
    const lowerNetR = createValidLongThesis();
    const higherNetR = {
      ...createValidLongThesis(),
      targets: [{ price: 113_000, fraction: 1 }],
      expectedNetR: 4,
    };
    const result = selectTradeThesisCandidate({
      preferred: lowerNetR,
      alternatives: [higherNetR],
      baselineDirection: "LONG",
      snapshot,
      now,
    });

    expect(result.selected).toEqual(higherNetR);
    expect(result.selectedCandidateIndex).toBe(1);
  });
});
