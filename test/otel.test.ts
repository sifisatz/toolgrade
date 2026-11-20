import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Trajectory } from "../src/agent.js";
import { reportToOtelSpans, writeOtelExport } from "../src/export/otel.js";
import type { RunReport, TrialResult } from "../src/runner.js";

function trajectory(overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    finalText: "done",
    toolCalls: [],
    turns: 1,
    stopReason: "end_turn",
    durationMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    ...overrides,
  };
}

function trial(overrides: Partial<TrialResult> = {}): TrialResult {
  return {
    taskId: "find-owner",
    arm: "tools",
    trial: 1,
    passed: true,
    assertions: [],
    skipped: [],
    trajectory: trajectory(),
    usage: { inputTokens: 100, outputTokens: 50 },
    costUsd: 0.01,
    ...overrides,
  };
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    version: 1,
    suite: "test-suite",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    provider: "anthropic",
    agentModel: "claude-opus-5",
    judgeModel: "claude-sonnet-5",
    trialsPerTask: 1,
    toolSurface: { count: 1, names: ["find_owner"], schemaChars: 10, approxTokens: 3, fingerprint: "abc", tools: [] },
    tasks: [{ taskId: "find-owner", prompt: "who owns x?", tags: [], tools: { rate: { rate: 1, passes: 1, n: 1, low: 1, high: 1 }, errors: 0, meanToolCalls: 1, meanTurns: 1, meanInputTokens: 100, meanOutputTokens: 50, meanDurationMs: 1000, costUsd: 0.01 } }],
    overall: { tools: { rate: { rate: 1, passes: 1, n: 1, low: 1, high: 1 }, trials: { passed: 1, graded: 1, errors: 0 }, costUsd: 0.01 } },
    judgeCostUsd: 0,
    totalCostUsd: 0.01,
    costIsLowerBound: false,
    unpricedModels: [],
    gate: { passed: true, checks: [] },
    trials: [trial()],
    ...overrides,
  };
}

describe("reportToOtelSpans", () => {
  it("produces one root span per task and one child span per trial", () => {
    const spans = reportToOtelSpans(report());
    const root = spans.find((s) => s.name === "task.find-owner");
    const child = spans.find((s) => s.name === "task.find-owner.trial.1");
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parentSpanId).toBe(root!.spanId);
    expect(root!.parentSpanId).toBeUndefined();
    // Same trace for every span in the run.
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    expect(root!.traceId).toHaveLength(32);
    expect(root!.spanId).toHaveLength(16);
  });

  it("sets gen_ai and toolgrade attributes on the trial span", () => {
    const [, child] = reportToOtelSpans(report());
    expect(child!.attributes).toMatchObject({
      "gen_ai.request.model": "claude-opus-5",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
      "toolgrade.task.id": "find-owner",
      "toolgrade.arm": "tools",
      "toolgrade.trial.passed": true,
      "toolgrade.tool.calls": 0,
    });
  });

  it("emits one gen_ai.tool.execution event per tool call, truncating long arguments", () => {
    const bigArg = "x".repeat(3000);
    const r = report({
      trials: [
        trial({
          trajectory: trajectory({
            toolCalls: [
              { name: "find_owner", input: { query: bigArg }, output: "ok", isError: false, durationMs: 500 },
              { name: "notify", input: { to: "a" }, output: "fail", isError: true, durationMs: 200 },
            ],
          }),
        }),
      ],
    });
    const [, child] = reportToOtelSpans(r);
    expect(child!.events).toHaveLength(2);
    const [first, second] = child!.events!;
    expect(first!.name).toBe("gen_ai.tool.execution");
    expect(first!.attributes["gen_ai.tool.name"]).toBe("find_owner");
    expect((first!.attributes["gen_ai.tool.call.arguments"] as string).length).toBe(2000);
    expect(first!.attributes.error).toBe(false);
    expect(second!.attributes["gen_ai.tool.name"]).toBe("notify");
    expect(second!.attributes.error).toBe(true);
    // Events land within the trial's time window, in call order.
    expect(BigInt(first!.timeUnixNano)).toBeLessThanOrEqual(BigInt(second!.timeUnixNano));
  });

  it("handles errored trials with no trajectory", () => {
    const r = report({ trials: [trial({ trajectory: undefined, passed: false, error: "boom", usage: { inputTokens: 0, outputTokens: 0 } })] });
    const spans = reportToOtelSpans(r);
    const child = spans.find((s) => s.name.includes("trial"));
    expect(child!.events).toBeUndefined();
    expect(child!.attributes["toolgrade.trial.passed"]).toBe(false);
    expect(child!.attributes["toolgrade.trial.error"]).toBe("boom");
  });

  it("skips tasks with no trials (filtered out)", () => {
    const r = report({ tasks: [...report().tasks, { taskId: "other", prompt: "x", tags: [], tools: { rate: { rate: 0, passes: 0, n: 0, low: 0, high: 1 }, errors: 0, meanToolCalls: 0, meanTurns: 0, meanInputTokens: 0, meanOutputTokens: 0, meanDurationMs: 0, costUsd: 0 } }] });
    const spans = reportToOtelSpans(r);
    expect(spans.some((s) => s.name === "task.other")).toBe(false);
  });
});

describe("writeOtelExport", () => {
  it("writes a valid OTLP/JSON export request envelope", async () => {
    const out = join(tmpdir(), `toolgrade-otel-${Date.now()}.json`);
    try {
      await writeOtelExport(report(), out);
      const parsed = JSON.parse(await readFile(out, "utf8"));
      expect(parsed.resourceSpans).toHaveLength(1);
      const rs = parsed.resourceSpans[0];
      expect(rs.resource.attributes).toEqual([{ key: "service.name", value: { stringValue: "toolgrade" } }]);
      expect(rs.scopeSpans[0].scope.name).toBe("toolgrade");
      const spans = rs.scopeSpans[0].spans;
      expect(spans.length).toBeGreaterThan(0);
      for (const s of spans) {
        expect(s.kind).toBe(1); // SPAN_KIND_INTERNAL as an OTLP JSON integer enum
        expect(typeof s.traceId).toBe("string");
        expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(Array.isArray(s.attributes)).toBe(true);
        for (const attr of s.attributes) {
          expect(attr).toHaveProperty("key");
          expect(attr).toHaveProperty("value");
        }
      }
      // The trial span has a parentSpanId; the task root span does not.
      expect(spans.some((s: { parentSpanId?: string }) => s.parentSpanId)).toBe(true);
      expect(spans.some((s: { parentSpanId?: string }) => !s.parentSpanId)).toBe(true);
    } finally {
      await rm(out, { force: true });
    }
  });

  it("encodes numeric, boolean, and string attribute values with the right OTLP value kind", async () => {
    const out = join(tmpdir(), `toolgrade-otel-${Date.now()}-2.json`);
    try {
      await writeOtelExport(report(), out);
      const parsed = JSON.parse(await readFile(out, "utf8"));
      const spans = parsed.resourceSpans[0].scopeSpans[0].spans;
      const trialSpan = spans.find((s: { name: string }) => s.name.includes("trial"));
      const byKey = Object.fromEntries(trialSpan.attributes.map((a: { key: string; value: unknown }) => [a.key, a.value]));
      expect(byKey["gen_ai.usage.input_tokens"]).toEqual({ intValue: "100" });
      expect(byKey["toolgrade.trial.passed"]).toEqual({ boolValue: true });
      expect(byKey["toolgrade.arm"]).toEqual({ stringValue: "tools" });
    } finally {
      await rm(out, { force: true });
    }
  });
});
