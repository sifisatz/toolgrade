export const Z95 = 1.959964;

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}pp`;

export interface Interval {
  low: number;
  high: number;
}

export interface Rate extends Interval {
  /** May be fractional for task-level rates (mean of per-task rates times n). */
  passes: number;
  n: number;
  rate: number;
}

/** Wilson score interval: well behaved at small n and at 0% / 100%, unlike the normal approximation. */
export function wilson(passes: number, n: number, z = Z95): Interval {
  if (n === 0) return { low: 0, high: 1 };
  const p = passes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export function rate(passes: number, n: number, z = Z95): Rate {
  return { passes, n, rate: n === 0 ? 0 : passes / n, ...wilson(passes, n, z) };
}

/**
 * Suite-level rate from per-task pass rates, with the number of tasks as the effective sample
 * size. Trials of one task are strongly correlated, so pooling them as independent would make
 * the interval far too narrow; treating each task as one observation is the conservative bound.
 */
export function taskLevelRate(taskRates: number[], z = Z95): Rate {
  const n = taskRates.length;
  const mean = n === 0 ? 0 : taskRates.reduce((s, r) => s + r, 0) / n;
  return rate(mean * n, n, z);
}

export interface Difference extends Interval {
  delta: number;
}

/** Newcombe hybrid score interval for p1 - p2 (method 10), built from the two Wilson intervals. */
export function difference(a: Rate, b: Rate): Difference {
  const delta = a.rate - b.rate;
  const low = delta - Math.sqrt((a.rate - a.low) ** 2 + (b.high - b.rate) ** 2);
  const high = delta + Math.sqrt((a.high - a.rate) ** 2 + (b.rate - b.low) ** 2);
  return { delta, low: Math.max(-1, low), high: Math.min(1, high) };
}

export type Significance = "better" | "worse" | "not_significant";

export function significance(d: Difference): Significance {
  if (d.low > 0) return "better";
  if (d.high < 0) return "worse";
  return "not_significant";
}

/**
 * Unbiased pass@k estimator (Chen et al. 2021, "Evaluating Large Language Models Trained on Code").
 * More accurate than naive pass rate when k < n and c/n is high.
 * Returns the probability that at least one of k random samples passes.
 * When k=1, reduces to c/n (identical to naive).
 *
 * @param n - total trials
 * @param c - passing trials
 * @param k - samples to draw (k <= n)
 */
export function passAtK(n: number, c: number, k: number): number {
  if (k > n) throw new RangeError(`k=${k} > n=${n}`);
  if (c === 0) return 0;
  if (c === n) return 1;
  // When there are fewer failures than samples to draw, at least one must be a pass.
  if (n - c < k) return 1;
  // 1 - C(n-c, k) / C(n, k)
  // Computed in log space to avoid overflow for large n
  let logNumer = 0;
  let logDenom = 0;
  for (let i = 0; i < k; i++) {
    logNumer += Math.log(n - c - i);
    logDenom += Math.log(n - i);
  }
  return 1 - Math.exp(logNumer - logDenom);
}

/** pass@1 = c/n (naive rate). Provided for symmetry with pass3/pass5. */
export const pass1 = (n: number, c: number): number => passAtK(n, c, 1);
/** pass@3 unbiased estimator. Requires n >= 3. */
export const pass3 = (n: number, c: number): number => passAtK(n, c, 3);
/** pass@5 unbiased estimator. Requires n >= 5. */
export const pass5 = (n: number, c: number): number => passAtK(n, c, 5);

// ---------------------------------------------------------------------------
// Trial-quality metrics (avoid importing from runner.ts to prevent cycles)
// ---------------------------------------------------------------------------

/** Minimal shape from TrialResult needed by the metrics below. */
export interface TrialLike {
  error?: string;
  passed: boolean;
  trajectory?: { toolCalls: Array<{ name: string }> };
}

/**
 * Fraction of non-errored trials where the agent called at least one tool.
 * Low value = agent ignoring tools entirely despite having them.
 */
export function toolEngagementRate(trials: TrialLike[]): number {
  const graded = trials.filter((t) => !t.error);
  if (graded.length === 0) return 0;
  const engaged = graded.filter((t) => (t.trajectory?.toolCalls.length ?? 0) > 0).length;
  return engaged / graded.length;
}

/**
 * For each tool name: ratio of trials that used it and PASSED to all trials that used it.
 * "When this tool was called, how often did the trial succeed?"
 * Returns map of tool_name → rate (0-1). Only includes tools called in ≥2 trials.
 */
export function perToolSuccessRate(trials: TrialLike[]): Record<string, number> {
  const graded = trials.filter((t) => !t.error && t.trajectory !== undefined);
  const toolData = new Map<string, { calls: number; passes: number }>();
  for (const trial of graded) {
    const usedTools = new Set((trial.trajectory?.toolCalls ?? []).map((tc) => tc.name));
    for (const name of usedTools) {
      const existing = toolData.get(name) ?? { calls: 0, passes: 0 };
      toolData.set(name, { calls: existing.calls + 1, passes: existing.passes + (trial.passed ? 1 : 0) });
    }
  }
  const result: Record<string, number> = {};
  for (const [name, { calls, passes }] of toolData) {
    if (calls >= 2) result[name] = passes / calls;
  }
  return result;
}

/** Two-sided z for family-wise alpha split over k comparisons (Bonferroni). */
export function bonferroniZ(k: number, alpha = 0.05): number {
  return probit(1 - alpha / (2 * Math.max(1, k)));
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function probit(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("probit needs 0 < p < 1");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lowTail = 0.02425;
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < lowTail) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - lowTail) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}
