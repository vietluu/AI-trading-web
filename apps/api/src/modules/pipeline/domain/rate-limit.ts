export function pipelineSkipReason(input: { hourlyCount: number; hourlyLimit: number; latestCreatedAt?: Date; now: Date; cooldownMs: number; replay: boolean }): 'MAX_RUNS_PER_HOUR' | 'SYMBOL_COOLDOWN_ACTIVE' | undefined {
  if (input.hourlyCount >= input.hourlyLimit) return 'MAX_RUNS_PER_HOUR';
  if (!input.replay && input.latestCreatedAt && input.now.getTime() - input.latestCreatedAt.getTime() < input.cooldownMs) return 'SYMBOL_COOLDOWN_ACTIVE';
  return undefined;
}
