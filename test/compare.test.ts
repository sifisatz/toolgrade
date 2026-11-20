import { describe, expect, it } from "vitest";
import { checkRegressionGate, compareRuns } from "../src/compare.js";
import { formatComparison } from "../src/report.js";
import type { ArmSummary, RunReport } from "../src/runner.js";

function armSummary(overrides: Partial<ArmSummary> = {}): ArmSummary {
  return { rate: { passes: 3, n: 3, rate: 1, low: 0.5, high: 1 }, errors: 0, meanToolCalls: 1, meanTurns: 1, meanInputTokens: 0, meanOutputTokens: 0, meanDurationMs: 0, costUsd: 0, ...overrides };
}

function report(toolNames: string[], overrides: Partial<RunReport> = {}, taskOverrides: Partial<ArmSummary> = {}): RunReport {
  return {
    tasks: [{ taskId: "t", prompt: "p", tags: [], tools: armSummary(taskOverrides) }],
    toolSurface: {
      count: toolNames.length,
      names: toolNames,
      schemaChars: 0,
      approxTokens: 0,
      fingerprint: "fp",
      tools: toolNames.map((name) => ({ name, hash: `hash-${name}` })),
    },
    ...overrides,
  } as unknown as RunReport;
}

describe("compareRuns tool surface diff", () => {
  it("reports no change when the tool set and hashes are identical", () => {
    const cmp = compareRuns(report(["a", "b"]), report(["a", "b"]));
    expect(cmp.toolSurface).toEqual({ changed: false, added: [], removed: [], changedTools: [] });
  });

  it("detects an added tool", () => {
    const cmp = compareRuns(report(["a"]), report(["a", "b"]));
    expect(cmp.toolSurface).toMatchObject({ changed: true, added: ["b"], removed: [] });
  });

  it("detects a removed tool", () => {
    const cmp = compareRuns(report(["a", "b"]), report(["a"]));
    expect(cmp.toolSurface).toMatchObject({ changed: true, added: [], removed: ["b"] });
  });

  it("detects a changed tool (same name, different hash)", () => {
    const before = report(["a"]);
    const after = report(["a"]);
    after.toolSurface.tools = [{ name: "a", hash: "different-hash" }];
    const cmp = compareRuns(before, after);
    expect(cmp.toolSurface).toMatchObject({ changed: true, changedTools: ["a"], added: [], removed: [] });
  });

  it("does not crash on a report with no tools array at all (an older report version)", () => {
    const before = report(["a"]);
    const after = report(["a"]);
    // @ts-expect-error simulating a pre-fingerprint report loaded from disk
    delete before.toolSurface.tools;
    const cmp = compareRuns(before, after);
    expect(cmp.toolSurface.changed).toBe(true); // "a" looks added since the old report has no tools list
  });
});

describe("formatComparison warns about an unstable comparison", () => {
  it("includes a tool-surface-changed warning with the specific tools when the surface differs", () => {
    const cmp = compareRuns(report(["a"]), report(["a", "b"]));
    const text = formatComparison(cmp);
    expect(text).toContain("tool surface changed");
    expect(text).toContain("added: b");
  });

  it("says nothing about the tool surface when it is unchanged", () => {
    const cmp = compareRuns(report(["a", "b"]), report(["a", "b"]));
    expect(formatComparison(cmp)).not.toContain("tool surface");
  });
});

describe("compareRuns cost/latency regression deltas", () => {
  it("reports a cost increase with the correct deltaPct", () => {
    const before = report(["a"], {}, { costUsd: 1 });
    const after = report(["a"], {}, { costUsd: 1.5 });
    const cmp = compareRuns(before, after);
    expect(cmp.tasks[0]!.costDelta).toEqual({ current: 1.5, baseline: 1, deltaPct: 0.5 });
  });

  it("reports a cost decrease as a negative deltaPct", () => {
    const before = report(["a"], {}, { costUsd: 2 });
    const after = report(["a"], {}, { costUsd: 1 });
    const cmp = compareRuns(before, after);
    expect(cmp.tasks[0]!.costDelta).toEqual({ current: 1, baseline: 2, deltaPct: -0.5 });
  });

  it("is null (not NaN/Infinity) when cost is missing or zero on either side", () => {
    const priced = report(["a"], {}, { costUsd: 1 });
    const unpriced = report(["a"], {}, { costUsd: null });
    const zero = report(["a"], {}, { costUsd: 0 });
    expect(compareRuns(priced, unpriced).tasks[0]!.costDelta).toBeNull();
    expect(compareRuns(unpriced, priced).tasks[0]!.costDelta).toBeNull();
    expect(compareRuns(priced, zero).tasks[0]!.costDelta).toBeNull();
  });

  it("computes the latency delta the same way as cost", () => {
    const before = report(["a"], {}, { meanDurationMs: 1000 });
    const after = report(["a"], {}, { meanDurationMs: 1300 });
    const cmp = compareRuns(before, after);
    expect(cmp.tasks[0]!.durationDelta).toEqual({ current: 1300, baseline: 1000, deltaPct: 0.3 });
  });

  it("is null when duration is missing or zero", () => {
    const before = report(["a"], {}, { meanDurationMs: 0 });
    const after = report(["a"], {}, { meanDurationMs: 1000 });
    expect(compareRuns(before, after).tasks[0]!.durationDelta).toBeNull();
  });
});

describe("checkRegressionGate", () => {
  it("fails the gate when a task's cost regresses beyond the threshold", () => {
    const before = report(["a"], {}, { costUsd: 1 });
    const after = report(["a"], {}, { costUsd: 1.5 }); // +50%
    const cmp = compareRuns(before, after);
    const checks = checkRegressionGate(cmp, { maxCostIncreasePct: 20 });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: "gate_cost_regression", passed: false });
    expect(checks[0]!.detail).toContain("t +50%");
  });

  it("passes the gate when the cost increase is within the threshold", () => {
    const before = report(["a"], {}, { costUsd: 1 });
    const after = report(["a"], {}, { costUsd: 1.1 }); // +10%
    const cmp = compareRuns(before, after);
    const checks = checkRegressionGate(cmp, { maxCostIncreasePct: 20 });
    expect(checks[0]).toMatchObject({ name: "gate_cost_regression", passed: true });
  });

  it("fails the gate on a latency regression beyond the threshold, independently of cost", () => {
    const before = report(["a"], {}, { costUsd: 1, meanDurationMs: 1000 });
    const after = report(["a"], {}, { costUsd: 1, meanDurationMs: 2000 }); // +100%
    const cmp = compareRuns(before, after);
    const checks = checkRegressionGate(cmp, { maxCostIncreasePct: 20, maxLatencyIncreasePct: 50 });
    expect(checks.find((c) => c.name === "gate_cost_regression")).toMatchObject({ passed: true });
    expect(checks.find((c) => c.name === "gate_latency_regression")).toMatchObject({ passed: false });
  });

  it("returns no checks when no thresholds are given", () => {
    const cmp = compareRuns(report(["a"]), report(["a"]));
    expect(checkRegressionGate(cmp, {})).toEqual([]);
  });
});
