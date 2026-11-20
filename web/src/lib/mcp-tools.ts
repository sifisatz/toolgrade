import { and, eq } from "drizzle-orm";
import { type Comparison, compareRuns } from "toolgrade/core";
import type { Db } from "@/db/client";
import { runs } from "@/db/schema";
import {
  queryRunsFiltered,
  type RunCursor,
  type RunSummaryRow,
} from "@/lib/run-history";

// Plain, db-first-argument functions, unit-testable without a request context - same split as
// lib/run-history.ts and lib/usage.ts. lib/mcp-server.ts wires these up as MCP tool handlers,
// scoped to the project an API key authenticated for.

/** An opaque pagination cursor for list_runs: base64url JSON of a RunCursor. */
export function encodeRunCursor(cursor: RunCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString("base64url");
}

/** Returns undefined for a missing/malformed cursor rather than throwing - callers treat it as "from the start". */
export function decodeRunCursor(
  raw: string | undefined,
): RunCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as {
      createdAt: string;
      id: string;
    };
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || typeof parsed.id !== "string")
      return undefined;
    return { createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

function summaryToJson(row: RunSummaryRow) {
  return {
    runId: row.id,
    suite: row.suite,
    completedAt: row.createdAt.toISOString(),
    taskCount: row.taskCount,
    trialsPerTask: row.trialsPerTask,
    passRate: row.passRate,
    baselineRate: row.baselineRate,
    lift: row.lift,
    liftSignificance: row.liftSignificance,
    gatePassed: row.gatePassed,
    totalCostUsd: row.totalCostUsd,
    branch: row.branch,
    commit: row.commit,
  };
}

export async function getLatestRun(db: Db, projectId: string, suite?: string) {
  const { rows } = await queryRunsFiltered(
    db,
    projectId,
    { suite },
    undefined,
    1,
  );
  const row = rows[0];
  if (!row) return { found: false as const };
  return { found: true as const, run: summaryToJson(row) };
}

export async function getLiftTrend(
  db: Db,
  projectId: string,
  suite: string,
  lastN: number,
) {
  const { rows } = await queryRunsFiltered(
    db,
    projectId,
    { suite },
    undefined,
    lastN,
  );
  // Newest-first from the query; present oldest-to-newest so "trend" reads left-to-right in time.
  const chronological = [...rows].reverse();
  const withLift = chronological.filter(
    (r): r is RunSummaryRow & { lift: number } => r.lift !== null,
  );
  let trend: "improving" | "stable" | "regressing" = "stable";
  if (withLift.length >= 2) {
    const first = withLift[0]!.lift;
    const last = withLift[withLift.length - 1]!.lift;
    const delta = last - first;
    if (delta > 0.05) trend = "improving";
    else if (delta < -0.05) trend = "regressing";
  }
  return {
    suite,
    runs: chronological.map((r) => ({
      runId: r.id,
      completedAt: r.createdAt.toISOString(),
      lift: r.lift,
      gatePassed: r.gatePassed,
    })),
    trend,
  };
}

async function loadReport(db: Db, projectId: string, runId: string) {
  const [row] = await db
    .select({ id: runs.id, report: runs.report })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.id, runId)))
    .limit(1);
  return row;
}

async function latestRunId(db: Db, projectId: string, suite?: string) {
  const { rows } = await queryRunsFiltered(
    db,
    projectId,
    { suite },
    undefined,
    1,
  );
  return rows[0]?.id;
}

export async function getFailingAssertions(
  db: Db,
  projectId: string,
  opts: { runId?: string; suite?: string },
) {
  const runId = opts.runId ?? (await latestRunId(db, projectId, opts.suite));
  if (!runId) return { found: false as const };
  const row = await loadReport(db, projectId, runId);
  if (!row) return { found: false as const };

  const failing = new Map<
    string,
    {
      taskName: string;
      assertionType: string;
      detail: string;
      trialsFailed: number;
      trialsTotal: number;
    }
  >();
  for (const trial of row.report.trials) {
    if (trial.arm !== "tools") continue;
    for (const assertion of trial.assertions) {
      if (assertion.passed) continue;
      const key = `${trial.taskId}::${assertion.type}`;
      const existing = failing.get(key);
      if (existing) existing.trialsFailed += 1;
      else
        failing.set(key, {
          taskName: trial.taskId,
          assertionType: assertion.type,
          detail: assertion.detail,
          trialsFailed: 1,
          trialsTotal: 0,
        });
    }
  }
  // trialsTotal = tools-arm trials run for that task, regardless of which assertion failed.
  const trialsPerTask = new Map<string, number>();
  for (const trial of row.report.trials) {
    if (trial.arm !== "tools") continue;
    trialsPerTask.set(trial.taskId, (trialsPerTask.get(trial.taskId) ?? 0) + 1);
  }
  for (const entry of failing.values())
    entry.trialsTotal = trialsPerTask.get(entry.taskName) ?? 0;

  return {
    found: true as const,
    runId,
    failingAssertions: [...failing.values()],
  };
}

export async function getCompareRuns(
  db: Db,
  projectId: string,
  baseRunId: string,
  headRunId: string,
): Promise<{ found: false } | { found: true; comparison: Comparison }> {
  const [base, head] = await Promise.all([
    loadReport(db, projectId, baseRunId),
    loadReport(db, projectId, headRunId),
  ]);
  if (!base || !head) return { found: false };
  return { found: true, comparison: compareRuns(base.report, head.report) };
}

export async function getToolUsage(db: Db, projectId: string, runId?: string) {
  const id = runId ?? (await latestRunId(db, projectId));
  if (!id) return { found: false as const };
  const row = await loadReport(db, projectId, id);
  if (!row) return { found: false as const };

  const callCount = new Map<string, number>();
  const errorCount = new Map<string, number>();
  for (const trial of row.report.trials) {
    if (trial.arm !== "tools" || !trial.trajectory) continue;
    for (const call of trial.trajectory.toolCalls) {
      callCount.set(call.name, (callCount.get(call.name) ?? 0) + 1);
      if (call.isError)
        errorCount.set(call.name, (errorCount.get(call.name) ?? 0) + 1);
    }
  }
  const tools = row.report.toolSurface.names.map((name) => ({
    name,
    callCount: callCount.get(name) ?? 0,
    errorCount: errorCount.get(name) ?? 0,
    neverCalled: !callCount.has(name),
  }));
  return { found: true as const, runId: id, tools };
}

export async function listRunsPage(
  db: Db,
  projectId: string,
  opts: { suite?: string; limit: number; cursor?: RunCursor },
) {
  const { rows, hasMore, nextCursor } = await queryRunsFiltered(
    db,
    projectId,
    { suite: opts.suite },
    opts.cursor,
    opts.limit,
  );
  return {
    runs: rows.map((r) => ({
      runId: r.id,
      suite: r.suite,
      completedAt: r.createdAt.toISOString(),
      lift: r.lift,
      gatePassed: r.gatePassed,
    })),
    hasMore,
    nextCursor: nextCursor ? encodeRunCursor(nextCursor) : undefined,
  };
}
