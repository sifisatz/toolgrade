import { describe, expect, it, vi } from "vitest";
import { parseSuite } from "../src/config.js";
import type { McpSession } from "../src/mcp.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import { runSuite } from "../src/runner.js";

function stubSession(): McpSession {
  return {
    tools: [],
    callTool: async () => ({ text: "", isError: false }),
    close: async () => undefined,
  };
}

describe("unisolated HTTP state warning", () => {
  it("warns when an HTTP server has state assertions and more than one trial", async () => {
    const suite = parseSuite(
      {
        server: { url: "http://example.invalid/mcp" },
        run: { trials: 2, baseline: false },
        tasks: [{ id: "t", prompt: "p", assert: [{ type: "state", tool: "read", args: {}, contains: "x" }] }],
      },
      import.meta.dirname,
    );
    const provider = new ScriptedProvider(() => ({ text: "x" }));
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runSuite(suite, { provider, openSession: async () => stubSession() });
      expect(write.mock.calls.map((c) => String(c[0])).join("")).toMatch(/HTTP MCP server.*state assertions/s);
    } finally {
      write.mockRestore();
    }
  });

  it("does not warn for a single trial", async () => {
    const suite = parseSuite(
      {
        server: { url: "http://example.invalid/mcp" },
        run: { trials: 1, baseline: false },
        tasks: [{ id: "t", prompt: "p", assert: [{ type: "state", tool: "read", args: {}, contains: "x" }] }],
      },
      import.meta.dirname,
    );
    const provider = new ScriptedProvider(() => ({ text: "x" }));
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runSuite(suite, { provider, openSession: async () => stubSession() });
      expect(write.mock.calls.length).toBe(0);
    } finally {
      write.mockRestore();
    }
  });

  it("does not warn for a stdio server", async () => {
    const suite = parseSuite(
      {
        server: { command: "node", args: [] },
        run: { trials: 2, baseline: false },
        tasks: [{ id: "t", prompt: "p", assert: [{ type: "state", tool: "read", args: {}, contains: "x" }] }],
      },
      import.meta.dirname,
    );
    const provider = new ScriptedProvider(() => ({ text: "x" }));
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runSuite(suite, { provider, openSession: async () => stubSession() });
      expect(write.mock.calls.length).toBe(0);
    } finally {
      write.mockRestore();
    }
  });
});

describe("infra vs model/tool failure classification", () => {
  function infraSuite() {
    return parseSuite(
      {
        server: { url: "http://example.invalid/mcp" },
        run: { trials: 1, baseline: false },
        tasks: [{ id: "t", prompt: "p", assert: [{ type: "output_contains", value: "expected" }] }],
      },
      import.meta.dirname,
    );
  }

  it("tags a 429 rate-limit rejection as infra and excludes it from the pass rate", async () => {
    const provider = new ScriptedProvider(() => {
      throw Object.assign(new Error("rate limited, please retry"), { status: 429 });
    });
    const report = await runSuite(infraSuite(), { provider, openSession: async () => stubSession() });

    expect(report.trials[0]!.outcome).toBe("infra");
    expect(report.trials[0]!.error).toBeTruthy();
    // Excluded from pass-rate math entirely: n=0, not counted as a pass or a fail.
    expect(report.tasks[0]!.tools.rate.n).toBe(0);
    expect(report.tasks[0]!.tools.infra).toBe(1);
    expect(report.tasks[0]!.tools.errors).toBe(0);
    // An infra rejection must not fail the no_errors gate - it isn't a model/tool bug.
    expect(report.gate.checks.find((c) => c.name === "no_errors")).toMatchObject({ passed: true });
  });

  it("tags a 400 budget-exceeded rejection as infra", async () => {
    const provider = new ScriptedProvider(() => {
      throw Object.assign(new Error("request rejected: monthly budget exceeded"), { status: 400 });
    });
    const report = await runSuite(infraSuite(), { provider, openSession: async () => stubSession() });
    expect(report.trials[0]!.outcome).toBe("infra");
  });

  it("still counts a genuine tool-use/assertion failure as fail, not infra", async () => {
    const provider = new ScriptedProvider(() => ({ text: "something unrelated" }));
    const report = await runSuite(infraSuite(), { provider, openSession: async () => stubSession() });

    expect(report.trials[0]!.outcome).toBe("fail");
    expect(report.trials[0]!.error).toBeUndefined();
    expect(report.tasks[0]!.tools.rate).toMatchObject({ n: 1, passes: 0 });
    expect(report.tasks[0]!.tools.infra ?? 0).toBe(0);
  });

  it("does not silently reclassify a plain thrown error with no infra signal - it still counts as fail", async () => {
    const provider = new ScriptedProvider(() => {
      throw new Error("something went wrong");
    });
    const report = await runSuite(infraSuite(), { provider, openSession: async () => stubSession() });

    expect(report.trials[0]!.outcome).toBe("fail");
    expect(report.tasks[0]!.tools.infra ?? 0).toBe(0);
    expect(report.tasks[0]!.tools.errors).toBe(1);
    expect(report.gate.checks.find((c) => c.name === "no_errors")).toMatchObject({ passed: false });
  });

  it("a 500 (server overload, no infra phrase) is not misclassified as infra", async () => {
    const provider = new ScriptedProvider(() => {
      throw Object.assign(new Error("internal server error"), { status: 500 });
    });
    const report = await runSuite(infraSuite(), { provider, openSession: async () => stubSession() });
    expect(report.trials[0]!.outcome).toBe("fail");
  });
});
