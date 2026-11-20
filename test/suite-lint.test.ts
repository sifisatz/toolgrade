import { describe, expect, it } from "vitest";
import { parseSuite } from "../src/config.js";
import { lintSuiteValidity } from "../src/suite-lint.js";

function suite(tasks: unknown[]) {
  return parseSuite({ server: { command: "x" }, tasks }, "/");
}

describe("lintSuiteValidity", () => {
  it("flags near-duplicate task prompts", () => {
    const findings = lintSuiteValidity(
      suite([
        { id: "a", prompt: "Find the note about the Q3 planning offsite and tell me who owns it", assert: [{ type: "tool_called", name: "x" }] },
        { id: "b", prompt: "Find the note about the Q3 planning offsite and tell me who owns it please", assert: [{ type: "tool_called", name: "x" }] },
        { id: "c", prompt: "Summarize the weather forecast for Tokyo next week", assert: [{ type: "tool_called", name: "x" }] },
      ]),
    );
    expect(findings.some((f) => f.severity === "warn" && f.taskId === "a" && /similar to "b"/.test(f.message))).toBe(true);
    expect(findings.some((f) => f.taskId === "c" && /similar/.test(f.message))).toBe(false);
  });

  it("flags output-only tasks not tagged control as solvable without tools", () => {
    const findings = lintSuiteValidity(
      suite([{ id: "t", prompt: "What is 2+2?", assert: [{ type: "output_contains", value: "4" }] }]),
    );
    expect(findings.some((f) => f.taskId === "t" && f.severity === "info" && /tool_called\/state assertion/.test(f.message))).toBe(true);
  });

  it("does not flag an output-only task tagged control", () => {
    const findings = lintSuiteValidity(
      suite([{ id: "t", prompt: "What is 2+2?", tags: ["control"], assert: [{ type: "output_contains", value: "4" }] }]),
    );
    expect(findings.some((f) => f.taskId === "t")).toBe(false);
  });

  it("does not flag a task that has a process assertion", () => {
    const findings = lintSuiteValidity(
      suite([{ id: "t", prompt: "Delete the note", assert: [{ type: "tool_called", name: "delete_note" }] }]),
    );
    expect(findings.some((f) => f.taskId === "t" && /tool_called\/state/.test(f.message))).toBe(false);
  });

  it("flags a task relying solely on an llm assertion as ambiguous", () => {
    const findings = lintSuiteValidity(
      suite([{ id: "t", prompt: "Write a nice haiku", assert: [{ type: "llm", rubric: "Is it a haiku?" }] }]),
    );
    expect(findings.some((f) => f.taskId === "t" && f.severity === "warn" && /no deterministic backstop/.test(f.message))).toBe(true);
  });

  it("does not flag an llm assertion paired with a deterministic one", () => {
    const findings = lintSuiteValidity(
      suite([
        {
          id: "t",
          prompt: "Write a nice haiku",
          assert: [
            { type: "llm", rubric: "Is it a haiku?" },
            { type: "output_regex", pattern: "." },
          ],
        },
      ]),
    );
    expect(findings.some((f) => f.taskId === "t" && /deterministic backstop/.test(f.message))).toBe(false);
  });
});
