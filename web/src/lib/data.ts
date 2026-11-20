import "server-only";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { apiKeys, member, organization, projects, runs } from "@/db/schema";
import { queryPendingInvitations } from "@/lib/invitations";
import { queryOrgMembers } from "@/lib/members";
import {
  queryModelMatrix,
  queryRunFilterOptions,
  queryRunsFiltered,
  type RunCursor,
  type RunFilters,
} from "@/lib/run-history";
import { getUsageStatus } from "@/lib/usage";

// Every read is request-time (connection()) and membership-scoped: orgs and projects are only
// ever looked up through the signed-in user's member row. Project-level reads below
// (listProjects, listRuns, getRun, ...) take ids that came out of those checked lookups.
// cache() de-duplicates identical lookups within one request (layout and page both ask).

export type { RunCursor, RunFilters } from "@/lib/run-history";

const TREND_POINTS = 20;

const runSummaryColumns = {
  id: runs.id,
  createdAt: runs.createdAt,
  source: runs.source,
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

export type RunSummary = Awaited<ReturnType<typeof listRuns>>["rows"][number];

/**
 * The org, only if `userId` is a member - with their role. Non-members get undefined, the same
 * as a missing org, so pages 404 without revealing that the org exists.
 */
export const getOrg = cache(async (userId: string, slug: string) => {
  await connection();
  const db = await getDb();
  const [row] = await db
    .select({ org: organization, role: member.role })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(organization.slug, slug), eq(member.userId, userId)))
    .limit(1);
  return row ? { ...row.org, role: row.role } : undefined;
});

export const getProject = cache(
  async (userId: string, orgSlug: string, projectSlug: string) => {
    await connection();
    const db = await getDb();
    const [row] = await db
      .select({ project: projects, org: organization, role: member.role })
      .from(projects)
      .innerJoin(organization, eq(projects.orgId, organization.id))
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(organization.slug, orgSlug),
          eq(projects.slug, projectSlug),
          eq(member.userId, userId),
        ),
      )
      .limit(1);
    return row;
  },
);

/** Every org the user belongs to, oldest membership first. */
export const listUserOrgs = cache(async (userId: string) => {
  await connection();
  const db = await getDb();
  return db
    .select({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(member.createdAt);
});

/** Projects with their run count and only the last TREND_POINTS runs each. */
export const listProjects = cache(async (orgId: string) => {
  await connection();
  const db = await getDb();
  const list = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(projects.name);
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);

  const counts = await db
    .select({ projectId: runs.projectId, n: count() })
    .from(runs)
    .where(inArray(runs.projectId, ids))
    .groupBy(runs.projectId);
  const ranked = db.$with("ranked").as(
    db
      .select({
        projectId: runs.projectId,
        ...runSummaryColumns,
        rn: sql<number>`row_number() over (partition by ${runs.projectId} order by ${runs.createdAt} desc)`.as(
          "rn",
        ),
      })
      .from(runs)
      .where(inArray(runs.projectId, ids)),
  );
  const recent = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rn, TREND_POINTS))
    .orderBy(desc(ranked.createdAt));

  return list.map((p) => {
    const mine = recent.filter((r) => r.projectId === p.id);
    return {
      ...p,
      latest: mine[0],
      runCount: Number(counts.find((c) => c.projectId === p.id)?.n ?? 0),
      trend: mine.map((r) => r.passRate).reverse(),
    };
  });
});

/** The most recent `limit` runs, plus the project's total run count so callers can tell when older runs were left out. */
export async function listRuns(projectId: string, limit = 100) {
  await connection();
  const db = await getDb();
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(runSummaryColumns)
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt))
      .limit(limit),
    db.select({ n: count() }).from(runs).where(eq(runs.projectId, projectId)),
  ]);
  return { rows, total: totalRow?.n ?? rows.length };
}

/**
 * Filtered, cursor-paginated run history for the dedicated /runs page - unlike listRuns (the
 * project overview's quick "latest 100" glance), this never silently caps at a fixed count: it
 * fetches one page at a time and says whether there's another. The actual query logic lives in
 * run-history.ts as a plain function, so it's testable without a request context for connection().
 */
export async function listRunsFiltered(
  projectId: string,
  filters: RunFilters,
  cursor?: RunCursor,
  pageSize = 50,
) {
  await connection();
  const db = await getDb();
  return queryRunsFiltered(db, projectId, filters, cursor, pageSize);
}

/** One row per agentModel this project has run, for comparing models on the same suite. */
export async function listModelMatrix(projectId: string) {
  await connection();
  const db = await getDb();
  return queryModelMatrix(db, projectId);
}

/** Distinct values seen for this project, to populate the run-history filter selects. */
export async function listRunFilterOptions(projectId: string) {
  await connection();
  const db = await getDb();
  return queryRunFilterOptions(db, projectId);
}

export async function getRun(projectId: string, runId: string) {
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return undefined;
  const db = await getDb();
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.id, runId)))
    .limit(1);
  return run;
}

/** The run immediately before the given time in the same project, for "vs previous" links. */
export async function getPreviousRunId(projectId: string, before: Date) {
  await connection();
  const db = await getDb();
  const [prev] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, before)))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return prev?.id;
}

export async function listApiKeys(projectId: string) {
  await connection();
  const db = await getDb();
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

/** The plan in effect plus this period's usage, for the billing panel on a project's settings page. */
export async function getBillingSummary(orgId: string, projectId: string) {
  await connection();
  const db = await getDb();
  const { entitlements, used, limit } = await getUsageStatus(
    db,
    orgId,
    projectId,
  );
  return { entitlements, usage: { used, limit } };
}

/** Every member of an org, for the Members page. */
export async function listOrgMembers(orgId: string) {
  await connection();
  const db = await getDb();
  return queryOrgMembers(db, orgId);
}

/** Every not-yet-expired pending invitation for an org, for the Members page. */
export async function listPendingInvitations(orgId: string) {
  await connection();
  const db = await getDb();
  return queryPendingInvitations(db, orgId);
}
