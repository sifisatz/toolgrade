import type { Suite, TaskSpec } from "./config.js";

export interface SuiteFinding {
  taskId: string;
  severity: "info" | "warn";
  message: string;
}

const PROCESS_ASSERTION_TYPES = new Set<TaskSpec["assert"][number]["type"]>(["tool_called", "tool_not_called", "max_tool_calls", "state"]);

/** Token-overlap Jaccard similarity on lowercased word tokens (simple and order-insensitive). */
function jaccardSimilarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

const DUPLICATE_THRESHOLD = 0.85;

/**
 * Static audit of a suite's task design (not the tools under test): no model calls.
 */
export function lintSuiteValidity(suite: Suite): SuiteFinding[] {
  const findings: SuiteFinding[] = [];
  const tasks = suite.tasks;

  // 1. Near-duplicate tasks (prompt similarity).
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!;
      const b = tasks[j]!;
      const similarity = jaccardSimilarity(a.prompt, b.prompt);
      if (similarity >= DUPLICATE_THRESHOLD) {
        findings.push({
          taskId: a.id,
          severity: "warn",
          message: `task "${a.id}" is ~${Math.round(similarity * 100)}% similar to "${b.id}"; likely redundant, wastes trial budget`,
        });
      }
    }
  }

  for (const task of tasks) {
    const hasProcessAssertion = task.assert.some((a) => PROCESS_ASSERTION_TYPES.has(a.type));
    const hasLlmAssertion = task.assert.some((a) => a.type === "llm");
    const isControl = task.tags.includes("control");

    // 2. Task solvable without tools: only output-based checks, not tagged control.
    if (!hasProcessAssertion && !isControl) {
      findings.push({
        taskId: task.id,
        severity: "info",
        message: `task "${task.id}" has no tool_called/state assertion; consider adding a process or state assertion, since output-only checks can pass even if no tool was used appropriately`,
      });
    }

    // 3. Ambiguous grading: an llm judge assertion with no other assertion type at all.
    if (hasLlmAssertion && task.assert.length === 1) {
      findings.push({
        taskId: task.id,
        severity: "warn",
        message: `task "${task.id}" relies entirely on LLM judgment with no deterministic backstop - judge model disagreement becomes unfalsifiable`,
      });
    }
  }

  return findings;
}
