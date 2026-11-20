import { join } from "node:path";
import { loadSuite, runSuite, ScriptedProvider } from "toolgrade";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { getDb } from "@/db/client";
import { apiKeys, organization, projects, runs } from "@/db/schema";
import { generateApiKey } from "@/lib/api-keys";
import { toRunRow, UploadSchema } from "@/lib/ingest";
import { notesAgent } from "../../examples/scripted-agent";

const SUITE = join(
  import.meta.dirname,
  "..",
  "..",
  "examples",
  "notes-suite.yaml",
);

// Live JSON-RPC smoke test against the real route handler: initialize -> resources/list ->
// resources/read, the same lifecycle a real MCP client runs, exercising auth, the stateless
// transport wiring in app/api/mcp/route.ts and the two resource handlers in lib/mcp-server.ts
// together rather than just their underlying lib/mcp-tools.ts functions in isolation.
let report: Awaited<ReturnType<typeof runSuite>>;
beforeAll(async () => {
  report = await runSuite(await loadSuite(SUITE), {
    provider: new ScriptedProvider(notesAgent),
    trials: 1,
  });
});

interface JsonRpcResponse {
  // biome-ignore lint/suspicious/noExplicitAny: result/error shapes vary per method; callers assert what they need.
  result?: any;
  error?: { code: number; message: string };
}

async function rpc(key: string, body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    }),
  );
  return { status: res.status, body: (await res.json()) as JsonRpcResponse };
}

describe("POST /api/mcp - resources", () => {
  let key: string;
  let projectId: string;
  let runWithYaml: { id: string };
  let runWithoutYaml: { id: string };

  beforeAll(async () => {
    const db = await getDb();
    const [org] = await db
      .insert(organization)
      .values({ slug: "mcp-route", name: "MCP Route" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, slug: "p", name: "P" })
      .returning();
    projectId = project!.id;
    const live = generateApiKey();
    await db.insert(apiKeys).values({
      projectId,
      name: "ci",
      prefix: live.prefix,
      hash: live.hash,
    });
    key = live.key;

    const row = toRunRow(projectId, UploadSchema.parse({ report }));
    const [withYaml] = await db
      .insert(runs)
      .values({ ...row, suiteYaml: "name: notes-suite\ntasks: []\n" })
      .returning();
    runWithYaml = withYaml!;
    const [withoutYaml] = await db.insert(runs).values(row).returning();
    runWithoutYaml = withoutYaml!;
  });

  it("initialize succeeds and advertises resource capability", async () => {
    const { status, body } = await rpc(key, {
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    expect(status).toBe(200);
    expect(body.result.capabilities.resources).toBeDefined();
  });

  it("resources/list enumerates the two static resource templates", async () => {
    const { status, body } = await rpc(key, {
      method: "resources/templates/list",
      params: {},
    });
    expect(status).toBe(200);
    const uris = (
      body.result.resourceTemplates as { uriTemplate: string }[]
    ).map((r) => r.uriTemplate);
    expect(uris).toContain("toolgrade://runs/{runId}/report");
    expect(uris).toContain("toolgrade://runs/{runId}/suite");
  });

  it("resources/read on the report resource returns the full RunReport", async () => {
    const { status, body } = await rpc(key, {
      method: "resources/read",
      params: { uri: `toolgrade://runs/${runWithYaml.id}/report` },
    });
    expect(status).toBe(200);
    const [content] = body.result.contents;
    expect(content.mimeType).toBe("application/json");
    const parsed = JSON.parse(content.text);
    expect(parsed.trials.length).toBe(report.trials.length);
  });

  it("resources/read on the suite resource returns the stored YAML", async () => {
    const { status, body } = await rpc(key, {
      method: "resources/read",
      params: { uri: `toolgrade://runs/${runWithYaml.id}/suite` },
    });
    expect(status).toBe(200);
    const [content] = body.result.contents;
    expect(content.mimeType).toBe("application/x-yaml");
    expect(content.text).toBe("name: notes-suite\ntasks: []\n");
  });

  it("resources/read on the suite resource returns a not-available notice when suite_yaml is null", async () => {
    const { status, body } = await rpc(key, {
      method: "resources/read",
      params: { uri: `toolgrade://runs/${runWithoutYaml.id}/suite` },
    });
    expect(status).toBe(200);
    const [content] = body.result.contents;
    expect(content.text).toMatch(/not available/i);
    expect(content.text.length).toBeGreaterThan(0);
  });

  it("resources/read 404s (as a JSON-RPC error) for a run in another project", async () => {
    const db = await getDb();
    const [otherOrg] = await db
      .insert(organization)
      .values({ slug: "mcp-route-other", name: "Other" })
      .returning();
    const [otherProject] = await db
      .insert(projects)
      .values({ orgId: otherOrg!.id, slug: "other", name: "Other" })
      .returning();
    const row = toRunRow(otherProject!.id, UploadSchema.parse({ report }));
    const [otherRun] = await db.insert(runs).values(row).returning();

    const { body } = await rpc(key, {
      method: "resources/read",
      params: { uri: `toolgrade://runs/${otherRun!.id}/report` },
    });
    expect(body.error).toBeDefined();
  });
});
