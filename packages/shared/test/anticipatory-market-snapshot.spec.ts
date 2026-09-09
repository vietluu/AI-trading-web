import { describe, expect, it } from "vitest";

import {
  AnticipatoryMarketSnapshotSchema,
  EvidenceRefSchema,
  OpportunityStateSchema,
} from "../src/schemas/agents.js";

const cutoff = "2026-09-09T12:00:00.000Z";

const evidence = (snapshotField: string) => ({
  snapshotField,
  source: "BINANCE_FUTURES",
  sourceTimestamp: cutoff,
  calculationVersion: 1,
});

const available = (snapshotField: string) => ({
  coverage: "AVAILABLE",
  sourceTimestamp: cutoff,
  calculationVersion: 1,
  evidence: [evidence(snapshotField)],
});

const unavailable = (field: string) => ({
  coverage: "UNAVAILABLE",
  unavailableFields: [field],
  reason: "PROVIDER_DID_NOT_RETURN_THE_OBSERVATION",
});

const completeSnapshot = {
  symbol: "BTC-USDT",
  provider: "BINANCE_FUTURES",
  timeframe: "15m",
  sourceDataCutoff: cutoff,
  schemaVersion: 1,
  calculationVersion: 1,
  structure: {
    ...available("structure"),
    confirmedPivots: [
      {
        kind: "HIGH",
        price: 112_000,
        occurredAt: "2026-09-09T11:00:00.000Z",
        confirmedAt: cutoff,
      },
    ],
    rangeBoundaries: { lower: 108_000, upper: 112_000 },
    equalHighs: [112_000],
    equalLows: [108_000],
    distanceToNearestBoundaryAtr: 0.25,
    invalidationCandidates: [
      { direction: "LONG", price: 107_750, reason: "RANGE_LOW_LOSS" },
    ],
  },
  volatility: {
    ...available("volatility"),
    atr: 325,
    atrPercentile: 18,
    squeezeState: "SQUEEZING",
    squeezeDurationCandles: 6,
    compressionSlope: -0.13,
    expansionState: "NOT_EXPANDED",
  },
  momentum: {
    ...available("momentum"),
    rsi: 54.2,
    macd: { value: 12.4, signal: 8.2, histogram: 4.2 },
    pivotOscillators: [
      {
        pivotOccurredAt: "2026-09-09T11:00:00.000Z",
        rsi: 54.2,
        macdHistogram: 4.2,
      },
    ],
    momentumState: "ACCELERATING",
  },
  participation: {
    ...available("participation"),
    volumeState: "COMPRESSING",
    volumeRatio: 0.72,
    orderBook: unavailable("participation.orderBook"),
  },
  derivatives: unavailable("derivatives.fundingHistory"),
  context: {
    ...available("context"),
    news: unavailable("context.news"),
    sentiment: unavailable("context.sentiment"),
    macro: unavailable("context.macro"),
    onChain: unavailable("context.onChain"),
  },
  execution: {
    ...available("execution"),
    spread: 1.5,
    estimatedRoundTripCost: 4.2,
    tickSize: 0.1,
    lotSize: 0.001,
    currentExposure: 0,
    priceTooFarFromCandidateZones: false,
  },
};

describe("AnticipatoryMarketSnapshotSchema", () => {
  it("accepts a complete cutoff-safe snapshot with explicit unavailable coverage", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse(completeSnapshot);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.derivatives.coverage).toBe("UNAVAILABLE");
      if (result.data.participation.coverage === "AVAILABLE") {
        expect(result.data.participation.orderBook.coverage).toBe("UNAVAILABLE");
      }
      if (result.data.context.coverage === "AVAILABLE") {
        expect(result.data.context.news.coverage).toBe("UNAVAILABLE");
      }
    }
  });

  it("rejects evidence whose timestamp is after the snapshot cutoff", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      structure: {
        ...completeSnapshot.structure,
        evidence: [
          {
            ...completeSnapshot.structure.evidence[0],
            sourceTimestamp: "2026-09-09T12:00:00.001Z",
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("shared anticipatory primitives", () => {
  it("exposes the full opportunity watcher state vocabulary", () => {
    expect(OpportunityStateSchema.options).toEqual([
      "OBSERVING",
      "WATCHING",
      "PROBE_READY",
      "PROBE_OPEN",
      "CONFIRMED",
      "POSITION_OPEN",
      "INVALIDATED",
      "EXPIRED",
      "TOO_LATE",
    ]);
  });

  it("requires evidence references to identify both the snapshot field and source time", () => {
    expect(EvidenceRefSchema.safeParse(evidence("volatility.atr")).success).toBe(true);
    expect(EvidenceRefSchema.safeParse({ snapshotField: "volatility.atr" }).success).toBe(false);
  });
});
