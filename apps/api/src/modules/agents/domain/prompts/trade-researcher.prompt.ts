export const TRADE_RESEARCHER_SYSTEM_PROMPT = `You are a high-conviction AI crypto trading researcher.
Your task is to analyze an anticipatory market snapshot and produce structured trade theses.

You will output up to 3 competing hypotheses (at most one per direction: LONG, SHORT, WAIT).
Choose ONE preferred hypothesis and preserve the others as alternatives.
Rigorously ground your evidence in the provided snapshot fields.
Do not hallucinate evidence or indicators that are not explicitly present in the data.

Your output must EXACTLY MATCH this JSON schema format:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "preferred": {
      "type": "object",
      "properties": {
        "thesisVersion": { "type": "number", "minimum": 1 },
        "decisionSource": { "type": "string", "enum": ["AI"] },
        "state": { "type": "string", "enum": ["WATCHING", "PROBE_READY", "CONFIRMED", "TOO_LATE", "WAIT"] },
        "direction": { "type": "string", "enum": ["LONG", "SHORT", "WAIT"] },
        "regime": { "type": "string" },
        "transitionProbability": { "type": "number", "minimum": 0, "maximum": 1 },
        "setup": { "type": "string", "enum": ["RANGE_REVERSAL", "LIQUIDITY_SWEEP_REVERSAL", "SQUEEZE_PROBE", "BREAKOUT_RETEST", "TREND_PULLBACK", "NO_TRADE"] },
        "entryZone": {
          "anyOf": [
            {
              "type": "object",
              "properties": { "lower": { "type": "number" }, "upper": { "type": "number" } },
              "required": ["lower", "upper"]
            },
            { "type": "null" }
          ]
        },
        "trigger": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": { "type": { "type": "string" }, "price": { "type": ["number", "null"] }, "description": { "type": "string" } },
            "required": ["type", "description", "price"]
          }
        },
        "invalidation": {
          "anyOf": [
            {
              "type": "object",
              "properties": { "price": { "type": "number" }, "reason": { "type": "string" } },
              "required": ["price", "reason"]
            },
            { "type": "null" }
          ]
        },
        "stopLoss": { "type": ["number", "null"] },
        "targets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": { "price": { "type": "number" }, "fraction": { "type": "number", "minimum": 0, "maximum": 1 } },
            "required": ["price", "fraction"]
          }
        },
        "expectedNetR": { "type": ["number", "null"] },
        "maximumChaseDistanceAtr": { "type": "number", "minimum": 0 },
        "confidence": { "type": "number", "minimum": 0, "maximum": 100 },
        "evidenceFor": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "snapshotField": { "type": "string" },
              "source": { "type": "string" },
              "sourceTimestamp": { "type": "string", "format": "date-time" },
              "calculationVersion": { "type": "number" }
            },
            "required": ["snapshotField", "source", "sourceTimestamp", "calculationVersion"]
          }
        },
        "evidenceAgainst": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "snapshotField": { "type": "string" },
              "source": { "type": "string" },
              "sourceTimestamp": { "type": "string", "format": "date-time" },
              "calculationVersion": { "type": "number" }
            },
            "required": ["snapshotField", "source", "sourceTimestamp", "calculationVersion"]
          }
        },
        "missingEvidence": { "type": "array", "items": { "type": "string" } },
        "expiresAt": { "type": "string", "format": "date-time" }
      },
      "required": ["thesisVersion", "decisionSource", "state", "direction", "regime", "transitionProbability", "setup", "entryZone", "trigger", "invalidation", "stopLoss", "targets", "expectedNetR", "maximumChaseDistanceAtr", "confidence", "evidenceFor", "evidenceAgainst", "missingEvidence", "expiresAt"]
    },
    "alternatives": {
      "type": "array",
      "items": {
        "description": "Same structure as preferred"
      }
    }
  },
  "required": ["preferred", "alternatives"]
}
`;

export const TRADE_THESIS_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    preferred: {
      type: "object",
      properties: {
        thesisVersion: { type: "number", minimum: 1 },
        decisionSource: { type: "string", enum: ["AI"] },
        state: { type: "string", enum: ["WATCHING", "PROBE_READY", "CONFIRMED", "TOO_LATE", "WAIT"] },
        direction: { type: "string", enum: ["LONG", "SHORT", "WAIT"] },
        regime: { type: "string" },
        transitionProbability: { type: "number", minimum: 0, maximum: 1 },
        setup: { type: "string", enum: ["RANGE_REVERSAL", "LIQUIDITY_SWEEP_REVERSAL", "SQUEEZE_PROBE", "BREAKOUT_RETEST", "TREND_PULLBACK", "NO_TRADE"] },
        entryZone: {
          anyOf: [
            {
              type: "object",
              properties: { lower: { type: "number" }, upper: { type: "number" } },
              required: ["lower", "upper"]
            },
            { type: "null" }
          ]
        },
        trigger: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string" }, price: { type: ["number", "null"] }, description: { type: "string" } },
            required: ["type", "description", "price"]
          }
        },
        invalidation: {
          anyOf: [
            {
              type: "object",
              properties: { price: { type: "number" }, reason: { type: "string" } },
              required: ["price", "reason"]
            },
            { type: "null" }
          ]
        },
        stopLoss: { type: ["number", "null"] },
        targets: {
          type: "array",
          items: {
            type: "object",
            properties: { price: { type: "number" }, fraction: { type: "number", minimum: 0, maximum: 1 } },
            required: ["price", "fraction"]
          }
        },
        expectedNetR: { type: ["number", "null"] },
        maximumChaseDistanceAtr: { type: "number", minimum: 0 },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        evidenceFor: {
          type: "array",
          items: {
            type: "object",
            properties: {
              snapshotField: { type: "string" },
              source: { "type": "string" },
              sourceTimestamp: { type: "string", format: "date-time" },
              calculationVersion: { type: "number" }
            },
            required: ["snapshotField", "source", "sourceTimestamp", "calculationVersion"]
          }
        },
        evidenceAgainst: {
          type: "array",
          items: {
            type: "object",
            properties: {
              snapshotField: { type: "string" },
              source: { "type": "string" },
              sourceTimestamp: { type: "string", format: "date-time" },
              calculationVersion: { type: "number" }
            },
            required: ["snapshotField", "source", "sourceTimestamp", "calculationVersion"]
          }
        },
        missingEvidence: { type: "array", items: { type: "string" } },
        expiresAt: { type: "string", format: "date-time" }
      },
      required: ["thesisVersion", "decisionSource", "state", "direction", "regime", "transitionProbability", "setup", "entryZone", "trigger", "invalidation", "stopLoss", "targets", "expectedNetR", "maximumChaseDistanceAtr", "confidence", "evidenceFor", "evidenceAgainst", "missingEvidence", "expiresAt"]
    },
    alternatives: {
      type: "array",
      items: {
        description: "Same structure as preferred"
      }
    }
  },
  required: ["preferred", "alternatives"]
};
