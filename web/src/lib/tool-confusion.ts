import type { RunReport } from "toolgrade/core";

export interface ConfusionPair {
  taskId: string;
  expectedTool: string;
  /** A tool that was actually called in a trial where the expected-tool assertion failed. */
  calledInstead: string;
  /** How many trials showed this exact substitution. */
  count: number;
}

/**
 * Per-task "expected vs. actually-called" signal: when a task's `tool_called` assertion fails
 * (the model didn't call the expected tool the required number of times), look at what the
 * trial's trajectory DID call instead and surface that as a decoy/confusion pair.
 *
 * Approximation note: `AssertionResult` (see toolgrade's assertions.ts) only carries
 * `{ type, passed, detail }` - a failed `tool_called` result does not carry the expected tool
 * name as a structured field anywhere in `RunReport`. The name only survives into the report
 * inside `detail`'s human-readable text, which assertions.ts builds as
 * `` `${spec.name} called ${n}x..., expected ${range}` ``. We recover `spec.name` by parsing that
 * prefix. This is inherently a bit fragile - if that wording ever changes upstream, this stops
 * matching silently (no expected tool recovered, no pairs produced for that assertion) rather than
 * throwing. Every tool actually called in the same trial, other than the expected one, is counted
 * as a possible substitute; we cannot know which single tool call the model intended to "stand in"
 * for the expected one, so a trial that called two unrelated tools produces two pairs rather than
 * one guess.
 */
export function toolConfusionPairs(report: RunReport): ConfusionPair[] {
  const counts = new Map<string, ConfusionPair>();
  for (const trial of report.trials) {
    if (!trial.trajectory) continue;
    const calledNames = new Set(trial.trajectory.toolCalls.map((c) => c.name));
    for (const assertion of trial.assertions) {
      if (assertion.type !== "tool_called" || assertion.passed) continue;
      const expectedTool = parseExpectedTool(assertion.detail);
      if (!expectedTool) continue;
      for (const calledInstead of calledNames) {
        if (calledInstead === expectedTool) continue;
        const key = `${trial.taskId}\u0000${expectedTool}\u0000${calledInstead}`;
        const entry = counts.get(key) ?? {
          taskId: trial.taskId,
          expectedTool,
          calledInstead,
          count: 0,
        };
        entry.count++;
        counts.set(key, entry);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** Matches assertions.ts's `${spec.name} called ${n}x...` detail wording for a tool_called result. */
function parseExpectedTool(detail: string): string | null {
  const m = /^(.+?) called \d+x/.exec(detail);
  return m ? m[1] : null;
}
