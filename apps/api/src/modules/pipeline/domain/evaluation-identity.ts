import { createHash } from "node:crypto";

export interface EvaluationIdentityInput {
  userId: string;
  provider: string;
  symbol: string;
  timeframe: string;
  sourceDataCutoff: Date | string;
  strategyKey: string;
  direction: string;
  configurationVersion: number | string;
}

function canonicalTimeframe(timeframe: string): string {
  const normalized = timeframe.trim().toLowerCase();
  const match = /^(\d+)\s*([mhd])$/.exec(normalized);
  if (!match) return normalized;
  return `${Number(match[1])}${match[2]}`;
}

export function buildEvaluationKey(input: EvaluationIdentityInput): string {
  const sourceDataCutoff = new Date(input.sourceDataCutoff);
  if (!Number.isFinite(sourceDataCutoff.getTime())) {
    throw new Error("sourceDataCutoff must be a valid timestamp");
  }

  const identity = {
    userId: input.userId.trim(),
    provider: input.provider.trim().toUpperCase(),
    symbol: input.symbol.trim().toUpperCase(),
    timeframe: canonicalTimeframe(input.timeframe),
    sourceDataCutoff: sourceDataCutoff.toISOString(),
    strategyKey: input.strategyKey.trim(),
    direction: input.direction.trim().toUpperCase(),
    configurationVersion: String(input.configurationVersion),
  };

  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
