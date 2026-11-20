import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadSuite, runSuite, ScriptedProvider } from "toolgrade";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/runs/route";
import { getDb } from "@/db/client";
import {
  apiKeys,
  organization,
  productEvents,
  projects,
  runs,
} from "@/db/schema";
import { bearerToken, generateApiKey, hashApiKey } from "@/lib/api-keys";
import { toRunRow, UploadSchema } from "@/lib/ingest";
import { billableUnits } from "@/lib/usage";
import { notesAgent } from "../../examples/scripted-agent";
import { giveActivePlan } from "./helpers";

const SUITE = join(
  import.meta.dirname,
  "..",
  "..",
  "examples",
  "notes-suite.yaml",
);

// A real report produced by the engine against the real example server: the contract test.
let report: Awaited<ReturnType<typeof runSuite>>;
beforeAll(async () => {
  report = await runSuite(await loadSuite(SUITE), {
    provider: new ScriptedProvider(notesAgent),
    trials: 1,
  });
});

describe("api keys", () => {
  it("generates prefixed random keys and stores only a hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^tg_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).not.toContain(a.key);
    expect(a.prefix).toBe(a.key.slice(0, 10));
  });

  it("only accepts Bearer tokens in toolgrade format", () => {
    expect(bearerToken("Bearer tg_abc")).toBe("tg_abc");
    expect(bearerToken("bearer tg_abc")).toBe("tg_abc");
    expect(bearerToken("Bearer sk-ant-123")).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});

describe("ingest schema (engine <-> platform contract)", () => {
  it("accepts a real engine report and indexes its headline numbers", () => {
    const upload = UploadSchema.parse({
      report,
      meta: { branch: "main", commit: "abc123" },
    });
    const row = toRunRow("p1", upload);
    expect(row.passRate).toBe(report.overall.tools.rate.rate);
    expect(row.lift).toBe(report.overall.lift?.delta);
    expect(row.gatePassed).toBe(report.gate.passed);
    expect(row.taskCount).toBe(6);
    expect(row.branch).toBe("main");
  });

  it("rejects something that is not a v1 report", () => {
    expect(
      UploadSchema.safeParse({ report: { ...report, version: 2 } }).success,
    ).toBe(false);
    expect(UploadSchema.safeParse({ report: { hello: "world" } }).success).toBe(
      false,
    );
  });
});

describe("POST /api/v1/runs", () => {
  let key: string;
  let revoked: string;
  let projectId: string;

  beforeAll(async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "t", name: "Test" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    projectId = project!.id;
    await giveActivePlan(db, org!.id, "team", projectId);
    const live = generateApiKey();
    const dead = generateApiKey();
    await db.insert(apiKeys).values([
      { projectId, name: "ci", prefix: live.prefix, hash: live.hash },
      {
        projectId,
        name: "old",
        prefix: dead.prefix,
        hash: dead.hash,
        revokedAt: new Date(),
      },
    ]);
    key = live.key;
    revoked = dead.key;
  });

  const post = (body: unknown, token?: string) =>
    POST(
      new Request("http://localhost:3000/api/v1/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("stores a valid upload and returns the run URL", async () => {
    const res = await post(
      {
        report,
        meta: { branch: "feat/x", commit: "deadbeef", commitMessage: "Try it" },
      },
      key,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.url).toBe(`http://localhost:3000/app/t/p/runs/${body.id}`);
    const db = await getDb();
    const stored = await db.select().from(runs);
    expect(stored.find((r) => r.id === body.id)).toMatchObject({
      projectId,
      branch: "feat/x",
      commitMessage: "Try it",
      passRate: report.overall.tools.rate.rate,
      billableUnits: billableUnits(report),
    });
    const used = (await db.select().from(apiKeys)).find((k) => k.name === "ci");
    expect(used!.lastUsedAt).not.toBeNull();

    const events = await db
      .select()
      .from(productEvents)
      .where(eq(productEvents.projectId, projectId));
    expect(events.find((e) => e.name === "run_ingested")).toMatchObject({
      organizationId: expect.any(String),
      projectId,
      properties: {
        gatePassed: report.gate.passed,
        taskCount: report.tasks.length,
      },
    });
  });

  it("stores suiteYaml when the CLI sends it, leaves it null when it doesn't", async () => {
    const withYaml = await post(
      {
        report,
        meta: { branch: "main" },
        suiteYaml: "name: notes-suite\ntasks: []\n",
      },
      key,
    );
    expect(withYaml.status).toBe(201);
    const withYamlId = ((await withYaml.json()) as { id: string }).id;

    const withoutYaml = await post({ report, meta: { branch: "main" } }, key);
    expect(withoutYaml.status).toBe(201);
    const withoutYamlId = ((await withoutYaml.json()) as { id: string }).id;

    const db = await getDb();
    const stored = await db.select().from(runs);
    expect(stored.find((r) => r.id === withYamlId)?.suiteYaml).toBe(
      "name: notes-suite\ntasks: []\n",
    );
    expect(stored.find((r) => r.id === withoutYamlId)?.suiteYaml).toBeNull();
  });

  it("rejects missing, unknown and revoked keys", async () => {
    expect((await post({ report })).status).toBe(401);
    expect((await post({ report }, generateApiKey().key)).status).toBe(401);
    expect((await post({ report }, revoked)).status).toBe(401);
  });

  it("rejects malformed bodies with useful errors", async () => {
    expect((await post("{not json", key)).status).toBe(400);
    const res = await post({ report: { version: 1 } }, key);
    expect(res.status).toBe(422);
    expect(
      ((await res.json()) as { issues: unknown[] }).issues.length,
    ).toBeGreaterThan(0);
  });
});

describe("POST /api/v1/runs - usage limits", () => {
  const post = (token: string) =>
    POST(
      new Request("http://localhost:3000/api/v1/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ report }),
      }),
    );

  it("rejects an upload on the free plan - it has no hosted allowance at all", async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "free-limit", name: "Free Limit" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    const live = generateApiKey();
    await db.insert(apiKeys).values({
      projectId: project!.id,
      name: "ci",
      prefix: live.prefix,
      hash: live.hash,
    });

    const res = await post(live.key);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      usage: { used: number; limit: number };
      upgradeUrl: string;
    };
    expect(body.usage).toEqual({ used: 0, limit: 0 });
    expect(body.upgradeUrl).toBe(
      `http://localhost:3000/app/free-limit/p/settings`,
    );
    expect(
      await db.select().from(runs).where(eq(runs.projectId, project!.id)),
    ).toHaveLength(0);
  });

  it("rejects an upload once a paid plan's monthly allowance is already used up", async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "paid-limit", name: "Paid Limit" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    await giveActivePlan(db, org!.id, "early_access", project!.id); // 1000 units/month
    const live = generateApiKey();
    await db.insert(apiKeys).values({
      projectId: project!.id,
      name: "ci",
      prefix: live.prefix,
      hash: live.hash,
    });
    // Simulate prior uploads this period already at the plan's allowance.
    await db.insert(runs).values({
      ...toRunRow(project!.id, UploadSchema.parse({ report })),
      billableUnits: 1000,
    });

    const res = await post(live.key);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      usage: { used: number; limit: number };
    };
    expect(body.usage).toEqual({ used: 1000, limit: 1000 });
    expect(
      await db.select().from(runs).where(eq(runs.projectId, project!.id)),
    ).toHaveLength(1); // the seeded one only
  });

  it("still accepts an upload that is under the allowance", async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "under-limit", name: "Under Limit" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    await giveActivePlan(db, org!.id, "early_access", project!.id);
    const live = generateApiKey();
    await db.insert(apiKeys).values({
      projectId: project!.id,
      name: "ci",
      prefix: live.prefix,
      hash: live.hash,
    });
    await db.insert(runs).values({
      ...toRunRow(project!.id, UploadSchema.parse({ report })),
      billableUnits: 999,
    });

    expect((await post(live.key)).status).toBe(201);
  });
});

describe("POST /api/v1/runs - rate limiting", () => {
  it("rejects with 429 once an API key exceeds the per-minute upload limit", async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "rate-limit", name: "Rate Limit" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    await giveActivePlan(db, org!.id, "team", project!.id); // plenty of units, isolates this from the usage-limit test above
    const live = generateApiKey();
    await db.insert(apiKeys).values({
      projectId: project!.id,
      name: "ci",
      prefix: live.prefix,
      hash: live.hash,
    });

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await POST(
        new Request("http://localhost:3000/api/v1/runs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${live.key}`,
          },
          body: JSON.stringify({ report }),
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(201));
    expect(statuses[30]).toBe(429);
  });
});
