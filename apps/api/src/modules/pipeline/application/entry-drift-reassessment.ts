/**
 * Orchestration helper: call assess + execute. If execution fails with
 * ENTRY_PRICE_DRIFT, re-invoke assess (full deterministic re-assessment)
 * and execute exactly once more. Any other outcome stops immediately.
 *
 * This is a pure function: assess and execute are injected as callbacks
 * so it can be tested without framework dependencies.
 */
export interface DriftReassessmentOptions<T extends { outcome: string; errorCode?: string }> {
  assess: () => Promise<void>;
  execute: () => Promise<T>;
}

export async function executeWithSingleDriftReassessment<
  T extends { outcome: string; errorCode?: string },
>(options: DriftReassessmentOptions<T>): Promise<T> {
  const { assess, execute } = options;

  await assess();
  const first = await execute();

  if (
    first.outcome === "EXECUTION_FAILED" &&
    first.errorCode === "ENTRY_PRICE_DRIFT"
  ) {
    // Full deterministic re-assessment with refreshed market data.
    await assess();
    return execute();
  }

  return first;
}
