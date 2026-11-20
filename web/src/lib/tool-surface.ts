import type { RunReport } from "toolgrade/core";

export interface ToolUsage {
  name: string;
  timesCalled: number;
  errors: number;
  /** Fraction of trials that called this tool AND passed; null if fewer than 2 data points. */
  successRate: number | null;
}

export interface ToolSurfaceBreakdown {
  /** Tools that were called at least once, most-used first. */
  used: ToolUsage[];
  /** Tools in the server's tool surface that no trial ever called. */
  neverCalled: string[];
}

/**
 * How much of a run's tool surface actually got exercised - derived entirely from data already in
 * the report (toolSurface.names, trials[].trajectory.toolCalls), no new fields needed. A tool
 * being called at all doesn't mean it's useful (see README's statistics notes on lift vs calls),
 * but a tool that's *never* called in a whole run is at least worth a second look.
 */
export function toolSurfaceBreakdown(report: RunReport): ToolSurfaceBreakdown {
  const counts = new Map<
    string,
    {
      timesCalled: number;
      errors: number;
      calledTrials: number;
      passedTrials: number;
    }
  >();
  for (const trial of report.trials) {
    if (!trial.trajectory) continue;
    const toolsCalledThisTrial = new Set<string>();
    for (const call of trial.trajectory.toolCalls) {
      const entry = counts.get(call.name) ?? {
        timesCalled: 0,
        errors: 0,
        calledTrials: 0,
        passedTrials: 0,
      };
      entry.timesCalled++;
      if (call.isError) entry.errors++;
      counts.set(call.name, entry);
      toolsCalledThisTrial.add(call.name);
    }
    // For each unique tool called in this trial, track whether it passed
    for (const name of toolsCalledThisTrial) {
      const entry = counts.get(name)!;
      entry.calledTrials++;
      if (trial.passed) entry.passedTrials++;
    }
  }
  const used = [...counts.entries()]
    .map(([name, c]) => ({
      name,
      timesCalled: c.timesCalled,
      errors: c.errors,
      successRate: c.calledTrials >= 2 ? c.passedTrials / c.calledTrials : null,
    }))
    .sort((a, b) => b.timesCalled - a.timesCalled);
  const neverCalled = report.toolSurface.names.filter((n) => !counts.has(n));
  return { used, neverCalled };
}
