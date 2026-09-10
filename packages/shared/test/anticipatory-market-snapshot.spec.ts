import { describe, expect, it } from "vitest";

import {
  AnticipatoryMarketSnapshotSchema,
  EvidenceRefSchema,
  OpportunityStateSchema,
} from "../src/schemas/agents.js";

const cutoff = "2026-09-09T12:00:00.000Z";
const observedAt = "2026-09-09T11:59:00.000Z";

const evidence = (snapshotField: string) => ({
  snapshotField,
  source: "BINANCE_FUTURES",
  sourceTimestamp: observedAt,
  calculationVersion: 1,
});

const available = (snapshotField: string) => ({
  coverage: "AVAILABLE",
  freshness: "FRESH",
  observationAgeMs: 60_000,
  freshnessThresholdMs: 300_000,
  sourceTimestamp: observedAt,
  calculationVersion: 1,
  evidence: [evidence(snapshotField)],
});

const unavailable = (field: string) => ({
  coverage: "UNAVAILABLE",
  freshness: "UNAVAILABLE",
  observationAgeMs: null,
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
  eligibility: { status: "ELIGIBLE", reasons: [] },
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
    liquiditySweep: {
      ...available("structure.liquiditySweep"),
      detected: false,
      direction: null,
      sweepZone: null,
      penetration: 0,
      reclaimed: false,
    },
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
  derivatives: {
    ...available("derivatives"),
    fundingRate: 0.01,
    fundingRatePercentile: 72,
    openInterest: 1_200_000,
    openInterestChangePct: 3.4,
    priceOpenInterestDivergence: "ALIGNED",
    liquidationContext: unavailable("derivatives.liquidationContext"),
    derivativesImbalance: {
      ...available("derivatives.derivativesImbalance"),
      fundingExtreme: "NORMAL",
      oiPriceDivergence: "ALIGNED",
      squeezeProbability: 10,
      squeezeDirection: "NONE",
      signals: ["Market appears balanced."],
    },
  },
  context: {
    ...available("context"),
    news: unavailable("context.news"),
    sentiment: unavailable("context.sentiment"),
    macro: unavailable("context.macro"),
    onChain: unavailable("context.onChain"),
  },
  execution: {
    ...available("execution"),
    currentPrice: 111_200,
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
      expect(result.data.eligibility.status).toBe("ELIGIBLE");
      if (result.data.derivatives.coverage === "AVAILABLE") {
        const { derivativesImbalance } = result.data.derivatives;
        if (derivativesImbalance.coverage === "AVAILABLE") {
          expect(derivativesImbalance.squeezeDirection).toBe("NONE");
        }
      }
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

  it("rejects an eligible snapshot when core technical evidence is stale", () => {
    const staleAt = "2026-09-09T11:54:59.999Z";
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      volatility: {
        ...completeSnapshot.volatility,
        freshness: "STALE",
        observationAgeMs: 300_001,
        sourceTimestamp: staleAt,
        evidence: [
          {
            ...completeSnapshot.volatility.evidence[0],
            sourceTimestamp: staleAt,
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an eligible snapshot when core technical evidence is unavailable", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      momentum: unavailable("momentum"),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an eligible snapshot when participation evidence is unavailable", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      participation: unavailable("participation"),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an eligible snapshot when participation evidence is stale", () => {
    const staleAt = "2026-09-09T11:54:59.999Z";
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      participation: {
        ...completeSnapshot.participation,
        freshness: "STALE",
        observationAgeMs: 300_001,
        sourceTimestamp: staleAt,
        evidence: [
          {
            ...completeSnapshot.participation.evidence[0],
            sourceTimestamp: staleAt,
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an available derivatives imbalance without enough history", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      derivatives: {
        ...completeSnapshot.derivatives,
        derivativesImbalance: {
          ...completeSnapshot.derivatives.derivativesImbalance,
          oiPriceDivergence: "INSUFFICIENT_DATA",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects redundant order-book ageMs in favor of observationAgeMs", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      participation: {
        ...completeSnapshot.participation,
        orderBook: {
          ...available("participation.orderBook"),
          imbalance: 0.35,
          ageMs: 10,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a pivot confirmed before it occurred", () => {
    const result = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      structure: {
        ...completeSnapshot.structure,
        confirmedPivots: [
          {
            ...completeSnapshot.structure.confirmedPivots[0],
            occurredAt: cutoff,
            confirmedAt: observedAt,
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects evidence references that do not resolve to the snapshot or its calculation version", () => {
    const unresolved = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      momentum: {
        ...completeSnapshot.momentum,
        evidence: [evidence("momentum.notARealField")],
      },
    });
    const versionMismatch = AnticipatoryMarketSnapshotSchema.safeParse({
      ...completeSnapshot,
      execution: {
        ...completeSnapshot.execution,
        evidence: [
          {
            ...completeSnapshot.execution.evidence[0],
            calculationVersion: 2,
          },
        ],
      },
    });

    expect(unresolved.success).toBe(false);
    expect(versionMismatch.success).toBe(false);
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
