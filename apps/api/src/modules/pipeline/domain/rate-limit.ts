export function pipelineSkipReason(input: {
  hourlyCount: number;
  hourlyLimit: number;
  latestCreatedAt?: Date;
  now: Date;
  cooldownMs: number;
  /** True when triggered by the scheduler – these runs bypass the per-symbol
   *  cooldown because the user has already explicitly configured the cadence
   *  via the schedule interval/cron. Only MANUAL triggers respect cooldown. */
  isScheduled?: boolean;
  replay: boolean;
}): 'MAX_RUNS_PER_HOUR' | 'SYMBOL_COOLDOWN_ACTIVE' | undefined {
  if (input.hourlyCount >= input.hourlyLimit) return 'MAX_RUNS_PER_HOUR';
  // Scheduled and replay triggers bypass per-symbol cooldown: the schedule
  // interval itself is the user's intended cadence.
  if (
    !input.replay &&
    !input.isScheduled &&
    input.latestCreatedAt &&
    input.now.getTime() - input.latestCreatedAt.getTime() < input.cooldownMs
  ) {
    return 'SYMBOL_COOLDOWN_ACTIVE';
  }
  return undefined;
}

