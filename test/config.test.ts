import { describe, expect, it } from "vitest";
import { isStdio, parseSuite } from "../src/config.js";

const minimal = {
  server: { command: "node", args: ["server.js"], cwd: "srv" },
  tasks: [{ id: "t1", prompt: "hi", assert: [{ type: "output_contains", value: "hello" }] }],
};

describe("parseSuite", () => {
  it("applies defaults and resolves the server cwd against the suite file", () => {
    const s = parseSuite(minimal, "/repo/evals");
    expect(s.agent.model).toBe("claude-opus-5");
    expect(s.judge.model).toBe("claude-sonnet-5");
    expect(s.run).toEqual({ trials: 3, baseline: true, concurrency: 4 });
    expect(s.gate.min_pass_rate).toBe(0);
    expect(isStdio(s.server) && s.server.cwd).toBe("/repo/evals/srv");
    const a = s.tasks[0]!.assert[0]!;
    expect(a.type === "output_contains" && a.mode).toBe("all");
    expect(a.type === "output_contains" && a.negate).toBe(false);
  });

  it("accepts an HTTP server", () => {
    const s = parseSuite({ ...minimal, server: { url: "http://localhost:3000/mcp" } }, "/x");
    expect(isStdio(s.server)).toBe(false);
  });

  it("accepts an optional reset hook on an HTTP server", () => {
    const s = parseSuite({ ...minimal, server: { url: "http://localhost:3000/mcp", reset: { tool: "reset_db" } } }, "/x");
    expect(!isStdio(s.server) && s.server.reset).toEqual({ tool: "reset_db", args: {} });
  });

  it("rejects unknown assertion types with a readable message", () => {
    const bad = { ...minimal, tasks: [{ id: "t1", prompt: "hi", assert: [{ type: "vibes" }] }] };
    expect(() => parseSuite(bad, "/x")).toThrow(/Invalid suite file/);
  });

  it("rejects duplicate task ids", () => {
    const dup = { ...minimal, tasks: [minimal.tasks[0], minimal.tasks[0]] };
    expect(() => parseSuite(dup, "/x")).toThrow(/duplicate task id "t1"/);
  });

  it("rejects a task with no assertions", () => {
    const none = { ...minimal, tasks: [{ id: "t1", prompt: "hi", assert: [] }] };
    expect(() => parseSuite(none, "/x")).toThrow(/Invalid suite file/);
  });
});
