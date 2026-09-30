import type {
  AnticipatoryMarketSnapshot,
  ThesisValidationReasonCode,
  ThesisValidationResult,
  TradeThesis,
} from "@platform/shared";
import {
  calculateThesisNetR,
  validateTradeThesis,
} from "./trade-thesis-validator";

export type ThesisSelectionReason =
  | "ALIGNED_CANDIDATE_SELECTED"
  | "BASELINE_DECISION_WAIT"
  | "AI_BASELINE_DIRECTION_CONFLICT"
  | "NO_ALIGNED_EXECUTABLE_THESIS"
  | ThesisValidationReasonCode;

export interface ThesisCandidateSelection {
  selected?: TradeThesis;
  selectedCandidateIndex?: number;
  reason: ThesisSelectionReason;
  candidateCount: number;
  researchPreferredDirection: TradeThesis["direction"];
  baselineDirection: "LONG" | "SHORT" | "WAIT";
  directionAgreement: boolean;
  validations: ThesisValidationResult[];
}

export function selectTradeThesisCandidate(input: {
  preferred: TradeThesis;
  alternatives: TradeThesis[];
  baselineDirection: "LONG" | "SHORT" | "WAIT";
  snapshot: AnticipatoryMarketSnapshot;
  now: Date;
}): ThesisCandidateSelection {
  const candidates = [input.preferred, ...input.alternatives];
  const validations = candidates.map((candidate) =>
    validateTradeThesis(candidate, input.snapshot, { now: input.now }),
  );
  const base = {
    candidateCount: candidates.length,
    researchPreferredDirection: input.preferred.direction,
    baselineDirection: input.baselineDirection,
    validations,
  };

  if (input.baselineDirection === "WAIT") {
    return {
      ...base,
      selected: undefined,
      reason: "BASELINE_DECISION_WAIT",
      directionAgreement: false,
    };
  }

  const alignedIndexes = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.direction === input.baselineDirection);
  const directionAgreement = alignedIndexes.length > 0;
  const executable = alignedIndexes
    .filter(({ candidate, index }) =>
      validations[index]?.valid &&
      ["PROBE_READY", "CONFIRMED"].includes(candidate.state),
    )
    .map(({ candidate, index }) => ({
      candidate,
      index,
      netR: calculateThesisNetR(candidate, input.snapshot) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((left, right) =>
      right.netR - left.netR ||
      right.candidate.evidenceFor.length - left.candidate.evidenceFor.length ||
      left.candidate.missingEvidence.length - right.candidate.missingEvidence.length ||
      left.index - right.index,
    );

  const selected = executable[0];
  if (selected) {
    return {
      ...base,
      selected: selected.candidate,
      selectedCandidateIndex: selected.index,
      reason: "ALIGNED_CANDIDATE_SELECTED",
      directionAgreement: true,
    };
  }

  if (directionAgreement) {
    const firstAlignedIndex = alignedIndexes[0]?.index;
    const firstReason =
      firstAlignedIndex === undefined
        ? undefined
        : validations[firstAlignedIndex]?.reasonCodes[0];
    return {
      ...base,
      selected: undefined,
      reason: firstReason ?? "NO_ALIGNED_EXECUTABLE_THESIS",
      directionAgreement: true,
    };
  }

  const hasOppositeActionableCandidate = candidates.some(
    (candidate, index) =>
      candidate.direction !== "WAIT" &&
      ["PROBE_READY", "CONFIRMED"].includes(candidate.state) &&
      validations[index]?.valid,
  );
  return {
    ...base,
    selected: undefined,
    reason: hasOppositeActionableCandidate
      ? "AI_BASELINE_DIRECTION_CONFLICT"
      : "NO_ALIGNED_EXECUTABLE_THESIS",
    directionAgreement: false,
  };
}
