import type { RunReport } from "toolgrade/core";
import { describe, expect, it } from "vitest";
import { toolConfusionPairs } from "@/lib/tool-confusion";

function tooLCalledAssertion(
  name: string,
  passed: boolean,
  calledTimes: number,
) {
  return {
    type: "tool_called" as const,
    passed,
    detail: `${name} called ${calledTimes}x, expected >=1`,
  };
}

function trial(opts: {
  taskId?: string;
  assertions?: ReturnType<typeof tooLCalledAssertion>[];
  toolCalls?: Array<{ name: string }>;
  noTrajectory?: boolean;
}) {
  return {
    taskId: opts.taskId ?? "t",
    arm: "tools" as const,
    trial: 1,
    passed: false,
    assertions: opts.assertions ?? [],
    skipped: [],
    trajectory: opts.noTrajectory
      ? undefined
      : {
          finalText: "",
          toolCalls: (opts.toolCalls ?? []).map((c) => ({
            name: c.name,
            input: {},
            output: "",
            isError: false,
            durationMs: 1,
          })),
          turns: 1,
          stopReason: "end_turn",
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
        },
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
  };
}

function report(trials: ReturnType<typeof trial>[]): RunReport {
  return {
    toolSurface: {
      count: 0,
      names: [],
      schemaChars: 0,
      approxTokens: 0,
    },
    trials,
  } as unknown as RunReport;
}

describe("toolConfusionPairs", () => {
  it("produces one pair when a tool_called assertion fails and another tool was called", () => {
    const r = report([
      trial({
        taskId: "find-notes",
        assertions: [tooLCalledAssertion("search_notes", false, 0)],
        toolCalls: [{ name: "list_tags" }],
      }),
    ]);
    expect(toolConfusionPairs(r)).toEqual([
      {
        taskId: "find-notes",
        expectedTool: "search_notes",
        calledInstead: "list_tags",
        count: 1,
      },
    ]);
  });

  it("produces no pairs when the tool_called assertion passed", () => {
    const r = report([
      trial({
        taskId: "find-notes",
        assertions: [tooLCalledAssertion("search_notes", true, 1)],
        toolCalls: [{ name: "search_notes" }],
      }),
    ]);
    expect(toolConfusionPairs(r)).toEqual([]);
  });

  it("aggregates the same substitution across multiple trials into one pair with the right count", () => {
    const r = report([
      trial({
        taskId: "find-notes",
        assertions: [tooLCalledAssertion("search_notes", false, 0)],
        toolCalls: [{ name: "list_tags" }],
      }),
      trial({
        taskId: "find-notes",
        assertions: [tooLCalledAssertion("search_notes", false, 0)],
        toolCalls: [{ name: "list_tags" }],
      }),
      trial({
        taskId: "find-notes",
        assertions: [tooLCalledAssertion("search_notes", false, 0)],
        toolCalls: [{ name: "list_tags" }],
      }),
    ]);
    expect(toolConfusionPairs(r)).toEqual([
      {
        taskId: "find-notes",
        expectedTool: "search_notes",
        calledInstead: "list_tags",
        count: 3,
      },
    ]);
  });

  it("skips trials with no trajectory gracefully", () => {
    const r = report([
      trial({
        taskId: "find-notes",
        assertions: [tooLCalledAssertion("search_notes", false, 0)],
        noTrajectory: true,
      }),
    ]);
    expect(toolConfusionPairs(r)).toEqual([]);
  });

  it("does not pair the expected tool with itself", () => {
    const r = report([
      trial({
        taskId: "find-notes",
        // Assertion failed on count (called twice, required exactly once) but the expected tool
        // was still the one called - no substitute to report.
        assertions: [tooLCalledAssertion("search_notes", false, 2)],
        toolCalls: [{ name: "search_notes" }, { name: "search_notes" }],
      }),
    ]);
    expect(toolConfusionPairs(r)).toEqual([]);
  });
});
