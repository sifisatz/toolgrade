import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organization, projects, runs } from "@/db/schema";

// Slugs of the official ToolGrade benchmark projects.
// These are the public suites we run ourselves.
const OFFICIAL_SUITES = [
  "server-filesystem",
  "server-git",
  "server-sqlite",
  "server-time",
  "server-playwright",
  "server-memory",
];

export { OFFICIAL_SUITES };

export interface LeaderboardEntry {
  suiteName: string;
  serverPackage: string; // e.g. "@modelcontextprotocol/server-filesystem"
  serverVersion: string;
  agentModel: string;
  passRate: number;
  passRateLow: number;
  passRateHigh: number;
  lift: number | null;
  taskCount: number;
  gatePassed: boolean;
  runId: string;
  runDate: Date;
}

/**
 * Fetch the latest run for each official suite from the public "toolgrade" org.
 * Falls back to empty array if the org doesn't exist yet.
 */
export async function getLeaderboardData(): Promise<LeaderboardEntry[]> {
  try {
    const db = await getDb();

    const [org] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, "toolgrade"))
      .limit(1);

    if (!org) return [];

    const projectList = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(
        and(
          eq(projects.orgId, org.id),
          inArray(projects.slug, OFFICIAL_SUITES),
        ),
      );

    if (projectList.length === 0) return [];

    const projectIds = projectList.map((p) => p.id);

    // Get the latest run per project using a window function approach:
    // fetch the most recent run for each project
    const latestRuns = await Promise.all(
      projectIds.map(async (projectId) => {
        const [run] = await db
          .select({
            id: runs.id,
            projectId: runs.projectId,
            suite: runs.suite,
            agentModel: runs.agentModel,
            passRate: runs.passRate,
            passLow: runs.passLow,
            passHigh: runs.passHigh,
            lift: runs.lift,
            taskCount: runs.taskCount,
            gatePassed: runs.gatePassed,
            createdAt: runs.createdAt,
            report: runs.report,
          })
          .from(runs)
          .where(eq(runs.projectId, projectId))
          .orderBy(desc(runs.createdAt))
          .limit(1);
        return run ?? null;
      }),
    );

    const entries: LeaderboardEntry[] = [];
    for (const run of latestRuns) {
      if (!run) continue;
      const proj = projectList.find((p) => p.id === run.projectId);
      if (!proj) continue;

      const serverVersion =
        (run.report as { serverVersion?: string }).serverVersion ?? "unknown";
      const serverPackage =
        (run.report as { serverPackage?: string }).serverPackage ??
        `@modelcontextprotocol/${proj.slug}`;

      entries.push({
        suiteName: proj.slug,
        serverPackage,
        serverVersion,
        agentModel: run.agentModel,
        passRate: run.passRate,
        passRateLow: run.passLow,
        passRateHigh: run.passHigh,
        lift: run.lift,
        taskCount: run.taskCount,
        gatePassed: run.gatePassed,
        runId: run.id,
        runDate: run.createdAt,
      });
    }

    return entries.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
  } catch {
    return [];
  }
}
