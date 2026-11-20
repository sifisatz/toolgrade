import type { RunReport } from "toolgrade/core";
import { z } from "zod";
import type { RunInsert } from "@/db/schema";
import { billableUnits } from "@/lib/usage";

// Everything a page renders is validated here, with types and bounds that also fit the database
// columns, so a stored run can never crash its own pages later. Unknown keys are stripped; fields
// added in later engine versions get defaults so older reports still render.

const Str = (max: number) => z.string().max(max);
const Count = z.number().int().nonnegative().max(1_000_000_000);
const Unit = z.number().min(0).max(1);
const Signed = z.number().min(-1).max(1);
const Measure = z.number().nonnegative().max(1e12);
const Usd = z.number().nonnegative().max(10_000_000);

const RateSchema = z.object({
  passes: z.number().nonnegative().max(1e9),
  n: Count,
  rate: Unit,
  low: Unit,
  high: Unit,
});
const DiffSchema = z.object({ delta: Signed, low: Signed, high: Signed });
const Significance = z.enum(["better", "worse", "not_significant"]);

const ArmSummary = z.object({
  rate: RateSchema,
  errors: Count,
  meanToolCalls: Measure,
  meanTurns: Measure,
  meanInputTokens: Measure,
  meanOutputTokens: Measure,
  meanDurationMs: Measure,
  costUsd: Usd.nullable(),
});

const OverallArm = z.object({
  rate: RateSchema,
  trials: z.object({ passed: Count, graded: Count, errors: Count }),
  costUsd: Usd.nullable(),
});

const Task = z.object({
  taskId: Str(200),
  prompt: Str(20_000).optional(),
  tags: z.array(Str(100)).max(100).default([]),
  tools: ArmSummary,
  baseline: ArmSummary.optional(),
  lift: DiffSchema.optional(),
});

const Trajectory = z.object({
  finalText: Str(200_000),
  toolCalls: z
    .array(
      z.object({
        name: Str(200),
        input: z.record(z.string(), z.unknown()),
        output: Str(1_000_000),
        isError: z.boolean(),
        durationMs: Measure,
      }),
    )
    .max(10_000),
  turns: Count,
  stopReason: Str(100),
  incomplete: Str(100).optional(),
  inputTokens: Count,
  outputTokens: Count,
  durationMs: Measure,
});

const Trial = z.object({
  taskId: Str(200),
  arm: z.enum(["tools", "baseline"]),
  trial: Count,
  passed: z.boolean(),
  assertions: z
    .array(
      z.object({ type: Str(100), passed: z.boolean(), detail: Str(20_000) }),
    )
    .max(1000),
  skipped: z.array(Str(100)).max(1000).default([]),
  trajectory: Trajectory.optional(),
  error: Str(20_000).optional(),
  usage: z
    .object({ inputTokens: Count, outputTokens: Count })
    .default({ inputTokens: 0, outputTokens: 0 }),
  costUsd: Usd.nullable(),
});

const ReportSchema = z.object({
  version: z.literal(1),
  suite: Str(200).min(1),
  startedAt: Str(64),
  finishedAt: Str(64).optional(),
  provider: Str(100),
  agentModel: Str(200),
  judgeModel: Str(200),
  trialsPerTask: z.number().int().min(1).max(1000),
  toolSurface: z.object({
    count: Count,
    names: z.array(Str(200)).max(10_000),
    schemaChars: Count,
    approxTokens: Count,
    // Added later than the rest of this object (schema fingerprinting) - optional with a default
    // so a report uploaded by an older CLI version still ingests.
    fingerprint: Str(64).default(""),
    tools: z
      .array(z.object({ name: Str(200), hash: Str(64) }))
      .max(10_000)
      .default([]),
  }),
  tasks: z.array(Task).min(1).max(1000),
  overall: z.object({
    tools: OverallArm,
    baseline: OverallArm.optional(),
    lift: DiffSchema.optional(),
    liftTasks: Count.optional(),
    liftSignificance: Significance.optional(),
  }),
  judgeCostUsd: Usd.nullable(),
  totalCostUsd: Usd.nullable(),
  costIsLowerBound: z.boolean().default(false),
  unpricedModels: z.array(Str(200)).max(100).default([]),
  gate: z.object({
    passed: z.boolean(),
    checks: z
      .array(
        z.object({ name: Str(100), passed: z.boolean(), detail: Str(2000) }),
      )
      .max(100),
  }),
  trials: z.array(Trial).max(100_000),
});

export const UploadSchema = z.object({
  report: ReportSchema,
  meta: z
    .object({
      branch: Str(255).optional(),
      commit: z
        .string()
        .regex(/^[0-9a-f]{4,64}$/i)
        .optional(),
      commitMessage: Str(500).optional(),
    })
    .default({}),
  /** The suite file's raw YAML text, exposed as the toolgrade://runs/{runId}/suite MCP resource. Optional - older CLIs never send it. */
  suiteYaml: Str(1_000_000).optional(),
});

export type Upload = z.infer<typeof UploadSchema>;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Postgres text and jsonb reject NUL; refuse it up front instead of failing the insert. */
export function hasNul(raw: string): boolean {
  return raw.includes("\\u0000") || raw.includes("\u0000");
}

export function toRunRow(
  projectId: string,
  upload: Upload,
  source: "cli" | "demo" = "cli",
): RunInsert {
  const r = upload.report;
  const o = r.overall;
  return {
    projectId,
    source,
    suite: r.suite,
    provider: r.provider,
    agentModel: r.agentModel,
    judgeModel: r.judgeModel,
    trialsPerTask: r.trialsPerTask,
    taskCount: r.tasks.length,
    passRate: o.tools.rate.rate,
    passLow: o.tools.rate.low,
    passHigh: o.tools.rate.high,
    baselineRate: o.baseline?.rate.rate ?? null,
    lift: o.lift?.delta ?? null,
    liftLow: o.lift?.low ?? null,
    liftHigh: o.lift?.high ?? null,
    liftSignificance: o.liftSignificance ?? null,
    gatePassed: r.gate.passed,
    errors: o.tools.trials.errors,
    totalCostUsd: r.totalCostUsd,
    branch: upload.meta.branch ?? null,
    commit: upload.meta.commit ?? null,
    commitMessage: upload.meta.commitMessage ?? null,
    billableUnits: billableUnits(r as unknown as RunReport),
    report: r as unknown as RunReport,
    suiteYaml: upload.suiteYaml ?? null,
  };
}
