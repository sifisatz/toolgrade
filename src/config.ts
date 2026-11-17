import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const StdioServer = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  /** Directory copied into a fresh ${TRIAL_DIR} for every session (relative to the suite file). */
  fixture: z.string().optional(),
});

const HttpServer = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
  /** Tool called once per session, right after connecting, to reset server-side state for the new trial. */
  reset: z
    .object({
      tool: z.string(),
      args: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
});

const ServerConfig = z.union([StdioServer, HttpServer]);

const Assertion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("output_contains"),
    value: z.union([z.string(), z.array(z.string()).min(1)]),
    mode: z.enum(["all", "any"]).default("all"),
    case_sensitive: z.boolean().default(false),
    /** Passes when the value(s) are absent instead of present - e.g. proving a secret was never echoed back. */
    negate: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("output_regex"),
    pattern: z.string(),
    flags: z.string().default("i"),
    /** Passes when the pattern does not match instead of when it does. */
    negate: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("tool_called"),
    name: z.string(),
    min_times: z.number().int().min(1).default(1),
    max_times: z.number().int().min(1).optional(),
    args_contains: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("tool_not_called"),
    name: z.string(),
  }),
  z.object({
    type: z.literal("max_tool_calls"),
    value: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("state"),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
    contains: z.union([z.string(), z.array(z.string())]).optional(),
    not_contains: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({
    type: z.literal("llm"),
    rubric: z.string().min(1),
  }),
]);

const Task = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i, "task id must be a slug"),
  prompt: z.string().min(1),
  tags: z.array(z.string()).default([]),
  assert: z.array(Assertion).min(1),
});

const Price = z.object({ input: z.number().min(0), output: z.number().min(0) });

export const SuiteSchema = z.object({
  name: z.string().default("suite"),
  server: ServerConfig,
  agent: z
    .object({
      model: z.string().default("claude-opus-5"),
      system: z.string().optional(),
      max_turns: z.number().int().min(1).default(10),
      max_tokens: z.number().int().min(256).default(16000),
      max_tool_result_chars: z.number().int().min(100).default(20000),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    })
    .prefault({}),
  judge: z.object({ model: z.string().default("claude-sonnet-5") }).prefault({}),
  run: z
    .object({
      trials: z.number().int().min(1).max(100).default(3),
      baseline: z.boolean().default(true),
      concurrency: z.number().int().min(1).max(32).default(4),
    })
    .prefault({}),
  gate: z
    .object({
      min_pass_rate: z.number().min(0).max(1).default(0),
      min_lift: z.number().min(-1).max(1).optional(),
    })
    .prefault({}),
  pricing: z.record(z.string(), Price).default({}),
  tasks: z.array(Task).min(1),
});

export type Suite = z.infer<typeof SuiteSchema>;
export type ServerSpec = Suite["server"];
export type StdioServerSpec = z.infer<typeof StdioServer>;
export type TaskSpec = z.infer<typeof Task>;
export type AssertionSpec = z.infer<typeof Assertion>;

/**
 * Outcome assertions judge what the agent achieved; process assertions judge how it used tools.
 * The no-tool baseline is graded on outcomes only, otherwise lift would just mean "used tools".
 */
const OUTCOME_TYPES = new Set<AssertionSpec["type"]>(["output_contains", "output_regex", "state", "llm"]);

export function isOutcomeAssertion(a: AssertionSpec): boolean {
  return OUTCOME_TYPES.has(a.type);
}

export function isStdio(server: ServerSpec): server is StdioServerSpec {
  return "command" in server;
}

export function parseSuite(raw: unknown, baseDir: string): Suite {
  const result = SuiteSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid suite file:\n${z.prettifyError(result.error)}`);
  }
  const suite = result.data;
  const ids = new Set<string>();
  for (const task of suite.tasks) {
    if (ids.has(task.id)) throw new Error(`Invalid suite file: duplicate task id "${task.id}"`);
    ids.add(task.id);
  }
  if (isStdio(suite.server)) {
    // A cwd inside the per-trial sandbox is only known once the sandbox exists.
    if (!suite.server.cwd?.includes("${TRIAL_DIR}")) suite.server.cwd = resolve(baseDir, suite.server.cwd ?? ".");
    if (suite.server.fixture) suite.server.fixture = resolve(baseDir, suite.server.fixture);
  }
  return suite;
}

export async function loadSuite(path: string): Promise<Suite> {
  const text = await readFile(path, "utf8");
  return parseSuite(parseYaml(text), dirname(resolve(path)));
}
