import type { RunReport } from "toolgrade/core";
import { describe, expect, it } from "vitest";
import { toolSurfaceBreakdown } from "@/lib/tool-surface";

function trial(toolCalls: Array<{ name: string; isError?: boolean }>) {
  return {
    taskId: "t",
    arm: "tools" as const,
    trial: 1,
    passed: true,
    assertions: [],
    skipped: [],
    trajectory: {
      finalText: "",
      toolCalls: toolCalls.map((c) => ({
        name: c.name,
        input: {},
        output: "",
        isError: c.isError ?? false,
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

function report(
  toolSurfaceNames: string[],
  trials: ReturnType<typeof trial>[],
): RunReport {
  return {
    toolSurface: {
      count: toolSurfaceNames.length,
      names: toolSurfaceNames,
      schemaChars: 0,
      approxTokens: 0,
    },
    trials,
  } as unknown as RunReport;
}

describe("toolSurfaceBreakdown", () => {
  it("counts calls per tool and errors within them", () => {
    const r = report(
      ["search", "read", "delete"],
      [
        trial([
          { name: "search" },
          { name: "search" },
          { name: "read", isError: true },
        ]),
      ],
    );
    const { used, neverCalled } = toolSurfaceBreakdown(r);
    expect(used).toEqual(
      expect.arrayContaining([
        { name: "search", timesCalled: 2, errors: 0, successRate: null },
        { name: "read", timesCalled: 1, errors: 1, successRate: null },
      ]),
    );
    expect(neverCalled).toEqual(["delete"]);
  });

  it("sorts used tools most-called first", () => {
    const r = report(
      ["a", "b"],
      [trial([{ name: "a" }, { name: "b" }, { name: "b" }, { name: "b" }])],
    );
    expect(toolSurfaceBreakdown(r).used.map((u) => u.name)).toEqual(["b", "a"]);
  });

  it("lists every tool as never called when no trial has a trajectory", () => {
    const r = {
      toolSurface: {
        count: 2,
        names: ["a", "b"],
        schemaChars: 0,
        approxTokens: 0,
      },
      trials: [
        {
          taskId: "t",
          arm: "tools",
          trial: 1,
          passed: true,
          assertions: [],
          skipped: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
        },
      ],
    } as unknown as RunReport;
    const { used, neverCalled } = toolSurfaceBreakdown(r);
    expect(used).toEqual([]);
    expect(neverCalled).toEqual(["a", "b"]);
  });

  it("aggregates calls across multiple trials, not just the first", () => {
    const r = report(
      ["search"],
      [
        trial([{ name: "search" }]),
        trial([{ name: "search" }, { name: "search" }]),
      ],
    );
    expect(toolSurfaceBreakdown(r).used).toEqual([
      { name: "search", timesCalled: 3, errors: 0, successRate: 1 },
    ]);
  });
});
