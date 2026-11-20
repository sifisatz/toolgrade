import { join } from "node:path";
import { loadSuite, runSuite, ScriptedProvider } from "toolgrade";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { organization, projects, runs } from "@/db/schema";
import { toRunRow, UploadSchema } from "@/lib/ingest";
import {
  decodeRunCursor,
  encodeRunCursor,
  getCompareRuns,
  getFailingAssertions,
  getLatestRun,
  getLiftTrend,
  getRunReport,
  getSuiteYaml,
  getToolUsage,
  listRunsPage,
} from "@/lib/mcp-tools";
import { notesAgent } from "../../examples/scripted-agent";

const SUITE = join(
  import.meta.dirname,
  "..",
  "..",
  "examples",
  "notes-suite.yaml",
);

let report: Awaited<ReturnType<typeof runSuite>>;
beforeAll(async () => {
  report = await runSuite(await loadSuite(SUITE), {
    provider: new ScriptedProvider(notesAgent),
    trials: 2,
  });
});

async function seedRun(
  projectId: string,
  overrides: Partial<typeof runs.$inferInsert>,
) {
  const db = await getDb();
  const row = toRunRow(projectId, UploadSchema.parse({ report }));
  const [inserted] = await db
    .insert(runs)
    .values({ ...row, ...overrides })
    .returning();
  return inserted!;
}

describe("mcp-tools", () => {
  let projectId: string;
  let runA: { id: string };
  let runB: { id: string };

  beforeAll(async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "mcp-tools", name: "MCP Tools" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    projectId = project!.id;

    runA = await seedRun(projectId, {
      suite: "notes-suite.yaml",
      createdAt: new Date("2026-01-01"),
      lift: 0.2,
    });
    runB = await seedRun(projectId, {
      suite: "notes-suite.yaml",
      createdAt: new Date("2026-01-02"),
      lift: 0.5,
    });
  });

  it("get_latest_run returns the newest run with its suite", async () => {
    const db = await getDb();
    const result = await getLatestRun(db, projectId);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.run.runId).toBe(runB.id);
    expect(result.run.suite).toBe("notes-suite.yaml");
  });

  it("get_latest_run reports not found for an empty project", async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "mcp-tools-empty", name: "Empty" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "empty", name: "Empty" })
      .returning();
    const result = await getLatestRun(db, project!.id);
    expect(result.found).toBe(false);
  });

  it("get_lift_trend orders oldest-to-newest and reads the direction", async () => {
    const db = await getDb();
    const trend = await getLiftTrend(db, projectId, "notes-suite.yaml", 10);
    expect(trend.runs.map((r) => r.runId)).toEqual([runA.id, runB.id]);
    expect(trend.trend).toBe("improving");
  });

  it("get_failing_assertions is scoped to the tools arm and groups by task+type", async () => {
    const db = await getDb();
    const result = await getFailingAssertions(db, projectId, {
      runId: runB.id,
    });
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    for (const entry of result.failingAssertions) {
      expect(entry.trialsFailed).toBeLessThanOrEqual(entry.trialsTotal);
      expect(entry.trialsTotal).toBeGreaterThan(0);
    }
  });

  it("get_failing_assertions reports not found for an unknown run", async () => {
    const db = await getDb();
    const result = await getFailingAssertions(db, projectId, {
      runId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.found).toBe(false);
  });

  it("compare_runs delegates to compareRuns for two real reports", async () => {
    const db = await getDb();
    const result = await getCompareRuns(db, projectId, runA.id, runB.id);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.comparison.overall.before).toBeDefined();
    expect(result.comparison.overall.after).toBeDefined();
  });

  it("compare_runs reports not found when either run is missing", async () => {
    const db = await getDb();
    const result = await getCompareRuns(
      db,
      projectId,
      runA.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result.found).toBe(false);
  });

  it("get_tool_usage flags declared-but-never-called tools", async () => {
    const db = await getDb();
    const result = await getToolUsage(db, projectId, runB.id);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    const called = result.tools.filter((t) => t.callCount > 0);
    expect(called.length).toBeGreaterThan(0);
    for (const t of result.tools) {
      expect(t.neverCalled).toBe(t.callCount === 0);
    }
  });

  it("list_runs paginates with a cursor that round-trips", async () => {
    const db = await getDb();
    const page1 = await listRunsPage(db, projectId, { limit: 1 });
    expect(page1.runs).toHaveLength(1);
    expect(page1.runs[0]?.runId).toBe(runB.id);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await listRunsPage(db, projectId, {
      limit: 1,
      cursor: decodeRunCursor(page1.nextCursor),
    });
    expect(page2.runs).toHaveLength(1);
    expect(page2.runs[0]?.runId).toBe(runA.id);
    expect(page2.hasMore).toBe(false);
  });

  it("getRunReport returns the full report scoped to the project", async () => {
    const db = await getDb();
    const result = await getRunReport(db, projectId, runB.id);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.report.trials.length).toBe(report.trials.length);
    expect(result.report.suite).toBe(report.suite);
  });

  it("getRunReport reports not found for a run in another project", async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "mcp-tools-other", name: "Other" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "other", name: "Other" })
      .returning();
    const result = await getRunReport(db, project!.id, runB.id);
    expect(result.found).toBe(false);
  });

  it("getSuiteYaml returns null, not an error, when the run predates storing it", async () => {
    const db = await getDb();
    const result = await getSuiteYaml(db, projectId, runB.id);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.suiteYaml).toBeNull();
  });

  it("getSuiteYaml returns the stored text when the run has it", async () => {
    const withYaml = await seedRun(projectId, {
      suite: "notes-suite.yaml",
      createdAt: new Date("2026-01-03"),
      suiteYaml: "name: notes-suite\ntasks: []\n",
    });
    const db = await getDb();
    const result = await getSuiteYaml(db, projectId, withYaml.id);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.suiteYaml).toBe("name: notes-suite\ntasks: []\n");
  });

  it("getSuiteYaml reports not found for an unknown run", async () => {
    const db = await getDb();
    const result = await getSuiteYaml(
      db,
      projectId,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result.found).toBe(false);
  });

  it("decodeRunCursor returns undefined for garbage input instead of throwing", () => {
    expect(decodeRunCursor("not-valid-base64url-json")).toBeUndefined();
    expect(decodeRunCursor(undefined)).toBeUndefined();
  });

  it("encodeRunCursor/decodeRunCursor round-trip a cursor", () => {
    const cursor = { createdAt: new Date("2026-01-01T00:00:00Z"), id: "abc" };
    const decoded = decodeRunCursor(encodeRunCursor(cursor));
    expect(decoded?.id).toBe("abc");
    expect(decoded?.createdAt.toISOString()).toBe(
      cursor.createdAt.toISOString(),
    );
  });
});
