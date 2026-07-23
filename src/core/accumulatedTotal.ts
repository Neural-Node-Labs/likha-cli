/**
 * Accumulated Total Calculator
 *
 * Computes a running accumulated total of token usage across multiple runs.
 * Takes a parsed token count (from parseTokenCounts) and a prior accumulated
 * total, then returns the new accumulated total.
 *
 * If no prior accumulated total is provided (undefined/null), it initializes
 * to 0 before adding the current run's total.
 *
 * The result is returned both as a number and as a locale-formatted string
 * with commas (e.g. "3,873").
 */

export interface AccumulatedTotalResult {
  /** The prior accumulated total before this run (0 if none provided). */
  priorTotal: number;
  /** The current run's total token count. */
  currentRunTotal: number;
  /** The new accumulated total after adding the current run. */
  newTotal: number;
  /** The new accumulated total formatted with commas (e.g. "3,873"). */
  formatted: string;
}

/**
 * Compute the new accumulated total given a current run's token count and an
 * optional prior accumulated total.
 *
 * @param currentRunTotal - The total token count for the current run.
 * @param priorAccumulatedTotal - The accumulated total from prior runs (defaults to 0).
 * @returns AccumulatedTotalResult with the new total and its formatted string.
 */
export function computeAccumulatedTotal(
  currentRunTotal: number,
  priorAccumulatedTotal?: number
): AccumulatedTotalResult {
  const priorTotal = priorAccumulatedTotal ?? 0;
  const newTotal = priorTotal + currentRunTotal;

  return {
    priorTotal,
    currentRunTotal,
    newTotal,
    formatted: newTotal.toLocaleString("en-US"),
  };
}
