import {
  and,
  avg,
  count,
  desc,
  eq,
  gte,
  like,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "@/db/client";
import { runs } from "@/db/schema";

// Plain, db-first-argument functions (no next/server's connection(), which only works inside a
// real request) - this is what's actually unit tested. lib/data.ts's listRunsFiltered/
// listRunFilterOptions are thin connection()-wrapped callers of these, same split as
// lib/usage.ts's getUsageStatus and lib/entitlements.ts's getEntitlements.

export const runSummaryColumns = {
  id: runs.id,
  createdAt: runs.createdAt,
  source: runs.source,
  suite: runs.suite,
  provider: runs.provider,
  agentModel: runs.agentModel,
  trialsPerTask: runs.trialsPerTask,
  taskCount: runs.taskCount,
  passRate: runs.passRate,
  passLow: runs.passLow,
  passHigh: runs.passHigh,
  baselineRate: runs.baselineRate,
  lift: runs.lift,
  liftLow: runs.liftLow,
  liftHigh: runs.liftHigh,
  liftSignificance: runs.liftSignificance,
  gatePassed: runs.gatePassed,
  errors: runs.errors,
  totalCostUsd: runs.totalCostUsd,
  branch: runs.branch,
  commit: runs.commit,
  commitMessage: runs.commitMessage,
  annotationRating: runs.annotationRating,
};

export interface RunFilters {
  suite?: string;
  provider?: string;
  agentModel?: string;
  branch?: string;
  /** Prefix match, since users usually copy a short sha, not the full 40 characters. */
  commit?: string;
  gatePassed?: boolean;
  since?: Date;
  until?: Date;
}

/** An opaque pagination cursor: the last row's (createdAt, id) from the previous page. */
export interface RunCursor {
  createdAt: Date;
  id: string;
}

/**
 * Filtered, cursor-paginated run history for the dedicated /runs page - unlike listRuns (the
 * project overview's quick "latest 100" glance), this never silently caps at a fixed count: it
 * fetches one page at a time and says whether there's another.
 */
export async function queryRunsFiltered(
  db: Db,
  projectId: string,
  filters: RunFilters,
  cursor?: RunCursor,
  pageSize = 50,
) {
  const conditions = [eq(runs.projectId, projectId)];
  if (filters.suite) conditions.push(eq(runs.suite, filters.suite));
  if (filters.provider) conditions.push(eq(runs.provider, filters.provider));
  if (filters.agentModel)
    conditions.push(eq(runs.agentModel, filters.agentModel));
  if (filters.branch) conditions.push(eq(runs.branch, filters.branch));
  if (filters.commit) conditions.push(like(runs.commit, `${filters.commit}%`));
  if (filters.gatePassed !== undefined)
    conditions.push(eq(runs.gatePassed, filters.gatePassed));
  if (filters.since) conditions.push(gte(runs.createdAt, filters.since));
  if (filters.until) conditions.push(lte(runs.createdAt, filters.until));
  if (cursor) {
    conditions.push(
      or(
        lt(runs.createdAt, cursor.createdAt),
        and(eq(runs.createdAt, cursor.createdAt), lt(runs.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select(runSummaryColumns)
    .from(runs)
    .where(and(...conditions))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return {
    rows: page,
    hasMore,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : undefined,
  };
}

export type RunSummaryRow = Awaited<
  ReturnType<typeof queryRunsFiltered>
>["rows"][number];

export interface ModelMatrixRow {
  agentModel: string;
  runCount: number;
  avgPassRate: number;
  avgCostUsd: number | null;
  latest: RunSummaryRow;
  /** Oldest to newest pass rate, for a per-model sparkline. */
  trend: number[];
}

/**
 * One row per agentModel this project has ever run, for comparing models on the same suite:
 * how many runs, the latest run's full summary, a recent pass-rate trend, and averages across
 * every run on record (not just the trend window). Newest-latest-run-first.
 */
export async function queryModelMatrix(
  db: Db,
  projectId: string,
  trendPoints = 20,
): Promise<ModelMatrixRow[]> {
  const stats = await db
    .select({
      agentModel: runs.agentModel,
      n: count(),
      avgPassRate: avg(runs.passRate),
      avgCostUsd: avg(runs.totalCostUsd),
    })
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .groupBy(runs.agentModel);
  if (stats.length === 0) return [];

  const ranked = db.$with("ranked").as(
    db
      .select({
        ...runSummaryColumns,
        rn: sql<number>`row_number() over (partition by ${runs.agentModel} order by ${runs.createdAt} desc)`.as(
          "rn",
        ),
      })
      .from(runs)
      .where(eq(runs.projectId, projectId)),
  );
  const recent = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rn, trendPoints))
    .orderBy(desc(ranked.createdAt));

  return stats
    .map((s): ModelMatrixRow => {
      const mine = recent.filter((r) => r.agentModel === s.agentModel);
      return {
        agentModel: s.agentModel,
        runCount: Number(s.n),
        avgPassRate: Number(s.avgPassRate),
        avgCostUsd: s.avgCostUsd === null ? null : Number(s.avgCostUsd),
        latest: mine[0]!,
        trend: mine.map((r) => r.passRate).reverse(),
      };
    })
    .sort(
      (a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime(),
    );
}

/** Distinct values seen for this project, to populate the run-history filter selects. */
export async function queryRunFilterOptions(db: Db, projectId: string) {
  const [suites, providers, models, branches] = await Promise.all([
    db
      .selectDistinct({ v: runs.suite })
      .from(runs)
      .where(eq(runs.projectId, projectId)),
    db
      .selectDistinct({ v: runs.provider })
      .from(runs)
      .where(eq(runs.projectId, projectId)),
    db
      .selectDistinct({ v: runs.agentModel })
      .from(runs)
      .where(eq(runs.projectId, projectId)),
    db
      .selectDistinct({ v: runs.branch })
      .from(runs)
      .where(eq(runs.projectId, projectId)),
  ]);
  const strings = (rows: Array<{ v: string | null }>) =>
    rows
      .map((r) => r.v)
      .filter((v): v is string => v !== null)
      .sort();
  return {
    suites: strings(suites),
    providers: strings(providers),
    models: strings(models),
    branches: strings(branches),
  };
}
