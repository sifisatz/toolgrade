import type { McpTool } from "./mcp.js";

// ---------------------------------------------------------------------------
// Description quality scoring (heuristics inspired by arXiv:2609.10962)
// ---------------------------------------------------------------------------

export interface DescriptionQualityResult {
  toolName: string;
  /** Overall quality score 0–100 (higher is better). */
  score: number;
  /** Human-readable issues and suggestions. */
  issues: string[];
}

/** Common English action verbs that indicate a well-formed imperative description. */
const ACTION_VERBS = new Set([
  "read", "get", "list", "create", "update", "delete", "search", "find", "fetch",
  "write", "set", "add", "remove", "run", "execute", "call", "send", "post",
  "check", "query", "insert", "replace", "edit", "move", "copy", "rename",
  "open", "close", "connect", "disconnect", "start", "stop", "reset", "clear",
]);

/**
 * Score the description quality of each tool on a 0–100 scale.
 * Based on heuristics derived from "What a Random Draw from the MCP Registry Contains"
 * (arXiv:2609.10962): actionable first word, appropriate length, parameter mentions,
 * no redundancy with the tool name, and complete sentences.
 *
 * Scoring rubric (additive, capped at 100):
 *   - Base score: 50
 *   - Description length penalties/bonuses: <20 chars = -30, 20–50 = -10, 50–200 = 0, >200 = -5
 *   - Starts with an action verb: +20
 *   - Contains parameter hints (key parameter name in description): +15
 *   - No duplicate words with tool name: +10
 *   - Ends with terminal punctuation (complete sentence): +5
 */
export function lintToolDescriptions(tools: McpTool[]): DescriptionQualityResult[] {
  return tools.map((tool) => {
    const issues: string[] = [];
    let score = 50;

    const desc = tool.description?.trim() ?? "";
    const descLen = desc.length;

    // --- Length ---
    if (descLen < 20) {
      score -= 30;
      issues.push(`description too short (${descLen} chars); aim for 50–200 chars that explain what, when, and what it returns`);
    } else if (descLen < 50) {
      score -= 10;
      issues.push(`description is brief (${descLen} chars); consider adding when to use this tool and what it returns`);
    } else if (descLen > 200) {
      score -= 5;
      issues.push(`description is long (${descLen} chars); consider trimming to 50–200 chars to reduce token overhead`);
    }

    // --- Starts with action verb ---
    const firstWord = desc.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
    if (firstWord && ACTION_VERBS.has(firstWord)) {
      score += 20;
    } else if (firstWord) {
      issues.push(`description should start with an action verb (Read, Get, List, Create, …); starts with "${firstWord}"`);
    }

    // --- Parameter hints ---
    const paramNames = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
    const descLower = desc.toLowerCase();
    const mentionedParams = paramNames.filter((p) => descLower.includes(p.toLowerCase()));
    if (paramNames.length > 0 && mentionedParams.length > 0) {
      score += 15;
    } else if (paramNames.length > 0) {
      issues.push(`consider mentioning key parameters (${paramNames.slice(0, 3).join(", ")}) in the description`);
    }

    // --- No duplicate words with tool name ---
    const toolWords = new Set(tool.name.toLowerCase().split(/[_-]+/).filter((w) => w.length > 2));
    const descWords = descLower.split(/\W+/);
    const redundant = descWords.filter((w) => w.length > 2 && toolWords.has(w));
    if (redundant.length === 0) {
      score += 10;
    } else {
      issues.push(`description repeats word(s) from the tool name (${[...new Set(redundant)].join(", ")}); use synonyms for clarity`);
    }

    // --- Ends with terminal punctuation ---
    if (/[.!?]$/.test(desc)) {
      score += 5;
    } else if (desc.length > 0) {
      issues.push("description does not end with punctuation; use a complete sentence for consistency");
    }

    return { toolName: tool.name, score: Math.max(0, Math.min(100, score)), issues };
  });
}

// ---------------------------------------------------------------------------
// Safety / destructive-action linting
// ---------------------------------------------------------------------------

export interface SafetyFinding {
  toolName: string;
  severity: "info" | "warn" | "danger";
  message: string;
}

const DESTRUCTIVE_VERBS = ["delete", "remove", "drop", "truncate", "wipe", "revoke", "terminate", "kill", "destroy"];
const WRITE_VERBS = ["create", "update", "set", "write", "insert"];
const INJECTION_PATTERNS = [/ignore (all )?previous instructions/i, /system\s*:/i, /you are now/i];

// Substring match (not \b-bounded): tool names commonly use underscores ("delete_note") and
// descriptions commonly conjugate the verb ("deletes", "removing"), neither of which a strict
// word-boundary match would catch.
const matchesAny = (text: string, words: string[]): string | undefined => {
  const lower = text.toLowerCase();
  return words.find((w) => lower.includes(w));
};

const hasAnyAnnotation = (a: McpTool["annotations"]): boolean =>
  a != null && (a.readOnlyHint !== undefined || a.destructiveHint !== undefined || a.idempotentHint !== undefined);

/** Collects every string value found anywhere in a JSON-shaped schema (e.g. example/default values). */
function collectSchemaStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectSchemaStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectSchemaStrings(v, out);
  return out;
}

/**
 * Static safety heuristics inspired by competitor tooling ("toolscope"): no model calls, no live
 * server runs - just name/description/annotation pattern matching.
 *
 * Notes on scope:
 *   - `outputSchema` is checked for prompt-injection bait when the server declares one (the MCP SDK
 *     used here does expose `Tool.outputSchema`); most servers in the wild don't set it, so this
 *     check will often have nothing to look at beyond the description.
 */
export function lintToolSafety(tools: McpTool[]): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  for (const tool of tools) {
    const haystack = `${tool.name} ${tool.description ?? ""}`;
    const annotations = tool.annotations;

    // 1. Destructive-sounding tool with no destructiveHint.
    const destructiveVerb = matchesAny(haystack, DESTRUCTIVE_VERBS);
    if (destructiveVerb && annotations?.destructiveHint !== true && annotations?.readOnlyHint === undefined) {
      findings.push({
        toolName: tool.name,
        severity: "danger",
        message: `${tool.name} looks destructive (matches /delete|remove|drop/) but declares no destructiveHint annotation`,
      });
    }

    // 2. Write-sounding tool with no idempotentHint declared at all.
    const writeVerb = matchesAny(haystack, WRITE_VERBS);
    if (writeVerb && annotations?.idempotentHint === undefined) {
      findings.push({
        toolName: tool.name,
        severity: "info",
        message: `${tool.name} looks like a write operation (matches /create|update|set|write|insert/) but declares no idempotentHint; callers (and ToolGrade's own retry logic) can't tell if it's safe to retry`,
      });
    }

    // 3. Prompt-injection-shaped bait in the description or declared outputSchema example/default values.
    const candidateStrings = [tool.description ?? "", ...collectSchemaStrings(tool.outputSchema)];
    for (const str of candidateStrings) {
      const hit = INJECTION_PATTERNS.find((p) => p.test(str));
      if (hit) {
        findings.push({
          toolName: tool.name,
          severity: "danger",
          message: `${tool.name} contains a prompt-injection-shaped phrase ("${str.slice(0, 80)}"): matches ${hit}`,
        });
        break;
      }
    }

    // 4. No annotations declared at all.
    if (!hasAnyAnnotation(annotations)) {
      findings.push({
        toolName: tool.name,
        severity: "info",
        message: `${tool.name} declares no behavior hints (readOnlyHint/destructiveHint/idempotentHint) - clients can't reason about safe retry or confirmation prompts`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// MCP annotation / spec compliance scoring
// ---------------------------------------------------------------------------

export interface ComplianceResult {
  toolName: string;
  compliant: boolean;
  missing: string[];
}

/**
 * Checks each tool against fields the current MCP tool spec recommends (not requires):
 * a non-empty description, documented input parameters, and at least one behavior annotation.
 */
export function lintSpecCompliance(tools: McpTool[]): { results: ComplianceResult[]; compliancePercent: number } {
  const results: ComplianceResult[] = tools.map((tool) => {
    const missing: string[] = [];

    if (!tool.description?.trim()) missing.push("description");

    const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
    const paramNames = Object.keys(props);
    if (paramNames.length > 0) {
      const documented = paramNames.filter((p) => props[p]?.description?.trim());
      if (documented.length < paramNames.length) {
        missing.push(`parameter descriptions (${documented.length}/${paramNames.length} documented)`);
      }
    }

    if (!hasAnyAnnotation(tool.annotations)) missing.push("annotations");

    return { toolName: tool.name, compliant: missing.length === 0, missing };
  });

  const compliancePercent = results.length === 0 ? 100 : Math.round((results.filter((r) => r.compliant).length / results.length) * 100);
  return { results, compliancePercent };
}

export interface LintIssue {
  tool: string;
  level: "error" | "warn";
  message: string;
}

const MIN_DESCRIPTION = 30;
const LARGE_SURFACE_CHARS = 40_000;

/** Static checks on what the model actually sees: names, descriptions, parameter docs. */
export function lintTools(tools: McpTool[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const names = new Map<string, number>();

  for (const tool of tools) {
    const add = (level: LintIssue["level"], message: string) => issues.push({ tool: tool.name, level, message });
    names.set(tool.name, (names.get(tool.name) ?? 0) + 1);

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) add("error", "name must match ^[a-zA-Z0-9_-]{1,64}$ or model APIs reject it");
    const desc = tool.description?.trim() ?? "";
    if (!desc) add("error", "no description: the model has only the name to go on");
    else if (desc.length < MIN_DESCRIPTION) add("warn", `description is ${desc.length} chars; say what it does, when to use it, and what it returns`);

    const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
    const required = new Set((tool.inputSchema.required as string[] | undefined) ?? []);
    for (const [param, schema] of Object.entries(props)) {
      if (!schema?.description) add("warn", `parameter "${param}" has no description`);
    }
    for (const r of required) {
      if (!(r in props)) add("error", `required parameter "${r}" is not declared in properties`);
    }
  }

  for (const [name, count] of names) {
    if (count > 1) issues.push({ tool: name, level: "error", message: `tool name declared ${count} times` });
  }
  const size = JSON.stringify(tools).length;
  if (size > LARGE_SURFACE_CHARS) {
    issues.push({ tool: "(surface)", level: "warn", message: `tool definitions are ~${Math.round(size / 4)} tokens on every request; consider fewer, broader tools` });
  }
  return issues;
}
