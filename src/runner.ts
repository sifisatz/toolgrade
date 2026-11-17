import { AgentRunError, runAgent, toAnthropicTools, type Trajectory, type Usage } from "./agent.js";
import { evaluateAll, withTrialDir, type AssertionResult } from "./assertions.js";
import { isOutcomeAssertion, isStdio, type AssertionSpec, type Suite, type TaskSpec } from "./config.js";
import { fingerprintSurface, fingerprintTools, type ToolFingerprint } from "./fingerprint.js";
import { todoTasks } from "./init.js";
import { LlmJudge } from "./judge.js";
import { openSession as defaultOpenSession, type McpSession } from "./mcp.js";
import { CostModel } from "./pricing.js";
import type { ModelProvider } from "./providers/types.js";
import { difference, pct, rate, significance, signedPct, taskLevelRate, type Difference, type Rate, type Significance } from "./stats.js";

export type Arm = "tools" | "baseline";

export interface TrialResult {
  taskId: string;
  arm: Arm;
  trial: number;
  passed: boolean;
  assertions: AssertionResult[];
  /** Process assertions not applied to this arm (baseline is graded on outcomes only). */
  skipped: AssertionSpec["type"][];
  trajectory?: Trajectory;
  /** Errored trials are excluded from pass rates and fail the no_errors gate check. */
  error?: string;
  usage: Usage;
  costUsd: number | null;
}

export interface ArmSummary {
  /** Trial-level rate over graded (non-errored) trials. */
  rate: Rate;
  errors: number;
  meanToolCalls: number;
  meanTurns: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanDurationMs: number;
  costUsd: number | null;
}

export interface OverallArm {
  /** Task-level rate: mean of per-task rates, n = tasks (see stats.taskLevelRate). */
  rate: Rate;
  trials: { passed: number; graded: number; errors: number };
  costUsd: number | null;
}

export interface TaskSummary {
  taskId: string;
  prompt: string;
  tags: string[];
  tools: ArmSummary;
  /** Absent when the arm did not run or the task has no outcome assertions to grade it on. */
  baseline?: ArmSummary;
  lift?: Difference;
}

export interface GateCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RunReport {
  version: 1;
  suite: string;
  startedAt: string;
  finishedAt: string;
  provider: string;
  agentModel: string;
  judgeModel: string;
  trialsPerTask: number;
  toolSurface: {
    count: number;
    names: string[];
    schemaChars: number;
    approxTokens: number;
    /** Changes if any tool's name, description or schema changes, or a tool is added/removed. */
    fingerprint: string;
    /** Per-tool fingerprints, so a comparison can say exactly which tools changed. */
    tools: ToolFingerprint[];
  };
  tasks: TaskSummary[];
  overall: {
    tools: OverallArm;
    baseline?: OverallArm;
    /** Computed only over tasks graded in both arms; `liftTasks` says how many. */
    lift?: Difference;
    liftTasks?: number;
    liftSignificance?: Significance;
  };
  judgeCostUsd: number | null;
  totalCostUsd: number | null;
  /** True when some trials errored: their failed request may not be counted. */
  costIsLowerBound: boolean;
  unpricedModels: string[];
  gate: { passed: boolean; checks: GateCheck[] };
  trials: TrialResult[];
}

export interface RunOptions {
  provider: ModelProvider;
  trials?: number;
  baseline?: boolean;
  concurrency?: number;
  filter?: string;
  openSession?: (server: Suite["server"]) => Promise<McpSession>;
  onTrial?: (t: TrialResult, done: number, total: number) => void;
}

export class FatalRunError extends Error {}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };

export async function runSuite(suite: Suite, opts: RunOptions): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const open = opts.openSession ?? defaultOpenSession;
  const trials = opts.trials ?? suite.run.trials;
  const withBaseline = opts.baseline ?? suite.run.baseline;
  const tasks = selectTasks(suite.tasks, opts.filter);
  const unfinished = todoTasks(tasks);
  if (unfinished.length) throw new Error(`Suite still has TODO placeholders in: ${unfinished.join(", ")} - write real prompts and rubrics first`);
  warnIfUnisolatedState(suite, tasks, trials);
  const costs = new CostModel(suite.pricing);
  const judge = new LlmJudge(opts.provider, suite.judge.model);
  let judgeIn = 0;
  let judgeOut = 0;

  // Probe once up front: fails fast on a broken server before any model spend.
  const probe = await open(suite.server);
  const anthropicTools = toAnthropicTools(probe.tools);
  await probe.close();
  const schemaChars = JSON.stringify(anthropicTools).length;

  const baselineEligible = (t: TaskSpec) => withBaseline && t.assert.some(isOutcomeAssertion);
  const jobs: Array<{ task: TaskSpec; arm: Arm; trial: number }> = [];
  for (const task of tasks) {
    const arms: Arm[] = baselineEligible(task) ? ["tools", "baseline"] : ["tools"];
    for (const arm of arms) for (let i = 1; i <= trials; i++) jobs.push({ task, arm, trial: i });
  }

  let done = 0;
  const results = await pool(jobs, opts.concurrency ?? suite.run.concurrency, async ({ task, arm, trial }) => {
    const result = await runTrial(task, arm, trial);
    opts.onTrial?.(result, ++done, jobs.length);
    return result;
  });

  async function runTrial(task: TaskSpec, arm: Arm, trial: number): Promise<TrialResult> {
    const graded = arm === "baseline" ? task.assert.filter(isOutcomeAssertion) : task.assert;
    const skipped = task.assert.filter((a) => !graded.includes(a)).map((a) => a.type);
    const base = { taskId: task.id, arm, trial, skipped };
    let session: McpSession | undefined;
    let trajectory: Trajectory | undefined;
    try {
      // Both arms get a fresh server so `state` assertions see an untouched world in the baseline too.
      session = await open(suite.server);
      // Prompts may name the session's sandbox (e.g. a repository path), like a user would.
      const prompt = withTrialDir(task.prompt, session.trialDir) as string;
      trajectory = await runAgent({
        provider: opts.provider,
        model: suite.agent.model,
        prompt,
        system: suite.agent.system,
        maxTurns: suite.agent.max_turns,
        maxTokens: suite.agent.max_tokens,
        maxToolResultChars: suite.agent.max_tool_result_chars,
        effort: suite.agent.effort,
        session: arm === "tools" ? session : undefined,
      });
      const assertions = await evaluateAll(graded, {
        prompt,
        trajectory,
        session,
        judge,
        onJudgeUsage: (i, o) => {
          judgeIn += i;
          judgeOut += o;
        },
      });
      const usage = { inputTokens: trajectory.inputTokens, outputTokens: trajectory.outputTokens };
      return {
        ...base,
        passed: trajectory.incomplete === undefined && assertions.every((a) => a.passed),
        assertions,
        trajectory,
        usage,
        costUsd: costs.cost(suite.agent.model, usage.inputTokens, usage.outputTokens),
      };
    } catch (err) {
      if (isFatal(err)) throw new FatalRunError(`Aborting run: ${errorMessage(err)}`);
      const usage = trajectory ?? (err instanceof AgentRunError ? err.usage : ZERO);
      return {
        ...base,
        passed: false,
        assertions: [],
        trajectory,
        error: errorMessage(err),
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        costUsd: costs.cost(suite.agent.model, usage.inputTokens, usage.outputTokens),
      };
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  const taskSummaries: TaskSummary[] = tasks.map((task) => {
    const mine = results.filter((r) => r.taskId === task.id);
    const tools = summarize(mine.filter((r) => r.arm === "tools"));
    const baseRuns = mine.filter((r) => r.arm === "baseline");
    const baseline = baseRuns.length ? summarize(baseRuns) : undefined;
    const lift = baseline && tools.rate.n > 0 && baseline.rate.n > 0 ? difference(tools.rate, baseline.rate) : undefined;
    return { taskId: task.id, prompt: task.prompt, tags: task.tags, tools, baseline, lift };
  });

  const overallTools = overallArm(taskSummaries, results, "tools");
  const liftSet = taskSummaries.filter((t) => t.lift);
  const overallBaseline = withBaseline ? overallArm(taskSummaries.filter((t) => t.baseline), results, "baseline") : undefined;
  const lift = liftSet.length
    ? difference(taskLevelRate(liftSet.map((t) => t.tools.rate.rate)), taskLevelRate(liftSet.map((t) => t.baseline!.rate.rate)))
    : undefined;

  const judgeCostUsd = judgeIn + judgeOut === 0 ? 0 : costs.cost(suite.judge.model, judgeIn, judgeOut);
  const totalCostUsd = sumCosts(results.map((r) => r.costUsd).concat(judgeCostUsd));
  const errors = results.filter((r) => r.error).length;

  const checks: GateCheck[] = [{ name: "no_errors", passed: errors === 0, detail: `${errors} trial(s) errored` }];
  if (suite.gate.min_pass_rate > 0) {
    checks.push({
      name: "min_pass_rate",
      passed: overallTools.rate.n > 0 && overallTools.rate.rate >= suite.gate.min_pass_rate,
      detail: `pass rate ${pct(overallTools.rate.rate)} vs required ${pct(suite.gate.min_pass_rate)}`,
    });
  }
  if (suite.gate.min_lift !== undefined) {
    checks.push(
      lift
        ? { name: "min_lift", passed: lift.delta >= suite.gate.min_lift, detail: `lift ${signedPct(lift.delta)} vs required ${signedPct(suite.gate.min_lift)}` }
        : { name: "min_lift", passed: false, detail: "no baseline was graded, so lift cannot be checked" },
    );
  }

  return {
    version: 1,
    suite: suite.name,
    startedAt,
    finishedAt: new Date().toISOString(),
    provider: opts.provider.name,
    agentModel: suite.agent.model,
    judgeModel: suite.judge.model,
    trialsPerTask: trials,
    toolSurface: {
      count: probe.tools.length,
      names: probe.tools.map((t) => t.name),
      schemaChars,
      approxTokens: Math.round(schemaChars / 4),
      fingerprint: fingerprintSurface(probe.tools),
      tools: fingerprintTools(probe.tools),
    },
    tasks: taskSummaries,
    overall: {
      tools: overallTools,
      baseline: overallBaseline,
      lift,
      liftTasks: lift ? liftSet.length : undefined,
      liftSignificance: lift ? significance(lift) : undefined,
    },
    judgeCostUsd,
    totalCostUsd,
    costIsLowerBound: errors > 0,
    unpricedModels: [...costs.unpriced],
    gate: { passed: checks.every((c) => c.passed), checks },
    trials: results,
  };
}

/**
 * Only stdio servers get a fresh sandboxed process per trial (see mcp.ts). An HTTP server's state
 * carries over between trials unless the suite declares a `reset` tool, so `state` assertions can
 * see leftovers from an earlier trial and silently misreport pass/fail - warn rather than let that
 * go unnoticed.
 */
function warnIfUnisolatedState(suite: Suite, tasks: TaskSpec[], trials: number): void {
  if (isStdio(suite.server) || trials <= 1 || suite.server.reset) return;
  const hasState = tasks.some((t) => t.assert.some((a) => a.type === "state"));
  if (!hasState) return;
  process.stderr.write(
    "toolgrade: warning: this suite uses an HTTP MCP server with state assertions and more than one trial. " +
      "Unlike stdio servers, HTTP servers are not sandboxed per trial - state may leak between trials unless " +
      "you configure server.reset or the server itself isolates state per session.\n",
  );
}

function selectTasks(tasks: TaskSpec[], filter?: string): TaskSpec[] {
  if (!filter) return tasks;
  const picked = tasks.filter((t) => t.id === filter || t.tags.includes(filter));
  if (picked.length === 0) throw new Error(`No task id or tag matches "${filter}"`);
  return picked;
}

function summarize(trials: TrialResult[]): ArmSummary {
  const graded = trials.filter((t) => !t.error);
  const ok = graded.map((t) => t.trajectory).filter((t): t is Trajectory => t !== undefined);
  const mean = (f: (t: Trajectory) => number) => (ok.length === 0 ? 0 : ok.reduce((s, t) => s + f(t), 0) / ok.length);
  return {
    rate: rate(graded.filter((t) => t.passed).length, graded.length),
    errors: trials.length - graded.length,
    meanToolCalls: mean((t) => t.toolCalls.length),
    meanTurns: mean((t) => t.turns),
    meanInputTokens: mean((t) => t.inputTokens),
    meanOutputTokens: mean((t) => t.outputTokens),
    meanDurationMs: mean((t) => t.durationMs),
    costUsd: sumCosts(trials.map((t) => t.costUsd)),
  };
}

function overallArm(tasks: TaskSummary[], results: TrialResult[], arm: Arm): OverallArm {
  const rated = tasks.map((t) => (arm === "tools" ? t.tools : t.baseline)).filter((a): a is ArmSummary => a !== undefined && a.rate.n > 0);
  const mine = results.filter((r) => r.arm === arm);
  return {
    rate: taskLevelRate(rated.map((a) => a.rate.rate)),
    trials: { passed: mine.filter((r) => r.passed).length, graded: mine.filter((r) => !r.error).length, errors: mine.filter((r) => r.error).length },
    costUsd: sumCosts(mine.map((r) => r.costUsd)),
  };
}

function sumCosts(values: Array<number | null>): number | null {
  return values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0);
}

/**
 * Config-level failures (bad key, unknown model, malformed request) repeat on every trial, so
 * they abort the run. A 400 after the first turn is different: the request grew with tool output
 * (e.g. prompt too long), which is a property of that trial, not of the configuration.
 */
function isFatal(err: unknown): boolean {
  const inner = err instanceof AgentRunError ? err.cause : err;
  const e = inner as { status?: unknown; fatal?: unknown; message?: unknown } | undefined;
  if (e?.fatal === true) return true;
  if (typeof e?.status !== "number") return false;
  if (e.status === 400) {
    const grewFromTools = err instanceof AgentRunError && err.turn > 1;
    const tooLong = typeof e.message === "string" && /too long|context|maximum/i.test(e.message);
    return !grewFromTools && !tooLong;
  }
  return [401, 403, 404].includes(e.status);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failed: unknown;
  const worker = async () => {
    while (failed === undefined && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i] as T);
      } catch (err) {
        failed ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (failed !== undefined) throw failed;
  return out;
}
