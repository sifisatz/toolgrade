import type { GateCheck, RunReport } from "./runner.js";
import { bonferroniZ, difference, rate, significance, taskLevelRate, type Difference, type Significance } from "./stats.js";

/** current/baseline plus the relative change between them, as a fraction (0.2 = +20%). */
export interface RegressionDelta {
  current: number;
  baseline: number;
  deltaPct: number;
}

export interface TaskComparison {
  taskId: string;
  before: number;
  after: number;
  diff: Difference;
  /** Bonferroni-corrected across all compared tasks, so big suites do not cry wolf. */
  significance: Significance;
  /** null when either run's cost for this task is missing or zero - never NaN/Infinity. */
  costDelta: RegressionDelta | null;
  /** null when either run's mean duration for this task is missing or zero. */
  durationDelta: RegressionDelta | null;
}

export interface ToolSurfaceDiff {
  /** True whenever anything below is non-empty - a quick "don't trust this comparison blindly" flag. */
  changed: boolean;
  added: string[];
  removed: string[];
  /** Present in both runs, but the tool's description or input schema differs. */
  changedTools: string[];
}

export interface Comparison {
  verdict: "regressed" | "improved" | "no_significant_change";
  /** Over matched tasks only, task-level (n = tasks), so different task sets never get mixed. */
  overall: { before: number; after: number; tasks: number; diff: Difference; significance: Significance };
  tasks: TaskComparison[];
  /** Tasks present (and graded) in only one of the two runs; excluded from every number above. */
  unmatched: string[];
  /** Whether the two runs even evaluated the same tool surface - a pass-rate change alongside a
   * changed tool surface may be explained by the tools, not by anything else that differs between
   * the runs (model, prompt, server logic). Never silently assumed to be comparable. */
  toolSurface: ToolSurfaceDiff;
}

function diffToolSurface(before: RunReport, after: RunReport): ToolSurfaceDiff {
  // Defensive: a report from before this field existed has no `tools` array at runtime even
  // though the type says it must - treated as "unknown," not a crash.
  const b = new Map((before.toolSurface.tools ?? []).map((t) => [t.name, t.hash]));
  const a = new Map((after.toolSurface.tools ?? []).map((t) => [t.name, t.hash]));
  const added = [...a.keys()].filter((name) => !b.has(name)).sort();
  const removed = [...b.keys()].filter((name) => !a.has(name)).sort();
  const changedTools = [...a.keys()].filter((name) => b.has(name) && b.get(name) !== a.get(name)).sort();
  return { changed: added.length > 0 || removed.length > 0 || changedTools.length > 0, added, removed, changedTools };
}

/** null rather than NaN/Infinity when either side is missing or zero - a 0 baseline has no meaningful % change. */
function regressionDelta(current: number | null | undefined, baseline: number | null | undefined): RegressionDelta | null {
  if (current === null || current === undefined || !current) return null;
  if (baseline === null || baseline === undefined || !baseline) return null;
  return { current, baseline, deltaPct: (current - baseline) / baseline };
}

export function compareRuns(before: RunReport, after: RunReport): Comparison {
  const graded = (r: RunReport) => new Map(r.tasks.filter((t) => t.tools.rate.n > 0).map((t) => [t.taskId, t.tools]));
  const b = graded(before);
  const a = graded(after);
  const matched = [...a.keys()].filter((id) => b.has(id));
  const unmatched = [...b.keys(), ...a.keys()].filter((id) => !(b.has(id) && a.has(id)));

  const z = bonferroniZ(matched.length);
  const tasks: TaskComparison[] = matched.map((id) => {
    const prev = b.get(id)!;
    const next = a.get(id)!;
    const diff = difference(rate(next.rate.passes, next.rate.n, z), rate(prev.rate.passes, prev.rate.n, z));
    return {
      taskId: id,
      before: prev.rate.rate,
      after: next.rate.rate,
      diff,
      significance: significance(diff),
      costDelta: regressionDelta(next.costUsd, prev.costUsd),
      durationDelta: regressionDelta(next.meanDurationMs, prev.meanDurationMs),
    };
  });

  const beforeRate = taskLevelRate(matched.map((id) => b.get(id)!.rate.rate));
  const afterRate = taskLevelRate(matched.map((id) => a.get(id)!.rate.rate));
  const diff = difference(afterRate, beforeRate);
  const overallSig = significance(diff);

  const anyWorse = overallSig === "worse" || tasks.some((t) => t.significance === "worse");
  const anyBetter = overallSig === "better" || tasks.some((t) => t.significance === "better");
  const verdict = anyWorse ? "regressed" : anyBetter ? "improved" : "no_significant_change";
  return {
    verdict,
    overall: { before: beforeRate.rate, after: afterRate.rate, tasks: matched.length, diff, significance: overallSig },
    tasks,
    unmatched,
    toolSurface: diffToolSurface(before, after),
  };
}

export interface RegressionGateOptions {
  /** Fail if any matched task's cost rose by more than this percent (e.g. 20 for 20%) vs the baseline run. */
  maxCostIncreasePct?: number;
  /** Fail if any matched task's mean duration rose by more than this percent vs the baseline run. */
  maxLatencyIncreasePct?: number;
}

/**
 * Cost/latency regression checks, in the same {name, passed, detail} shape as the suite gate checks
 * in runner.ts, so `toolgrade run --compare/--baseline --gate-cost-regression ...` fails the run the
 * same way `suite.gate` does rather than through a parallel pass/fail mechanism.
 */
export function checkRegressionGate(cmp: Comparison, opts: RegressionGateOptions): GateCheck[] {
  const checks: GateCheck[] = [];
  if (opts.maxCostIncreasePct !== undefined) {
    checks.push(regressionCheck("gate_cost_regression", "cost", cmp.tasks, (t) => t.costDelta, opts.maxCostIncreasePct));
  }
  if (opts.maxLatencyIncreasePct !== undefined) {
    checks.push(regressionCheck("gate_latency_regression", "latency", cmp.tasks, (t) => t.durationDelta, opts.maxLatencyIncreasePct));
  }
  return checks;
}

function regressionCheck(
  name: string,
  label: string,
  tasks: TaskComparison[],
  pick: (t: TaskComparison) => RegressionDelta | null,
  maxIncreasePct: number,
): GateCheck {
  const threshold = maxIncreasePct / 100;
  const offenders = tasks
    .map((t) => ({ taskId: t.taskId, delta: pick(t) }))
    .filter((x): x is { taskId: string; delta: RegressionDelta } => x.delta !== null && x.delta.deltaPct > threshold);
  const passed = offenders.length === 0;
  const detail = passed
    ? `no task's ${label} increased more than ${maxIncreasePct}% vs the baseline run`
    : `${label} regressed beyond ${maxIncreasePct}%: ${offenders.map((o) => `${o.taskId} +${Math.round(o.delta.deltaPct * 100)}%`).join(", ")}`;
  return { name, passed, detail };
}
