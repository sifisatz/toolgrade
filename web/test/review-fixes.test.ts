import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSuite, runSuite, ScriptedProvider } from "toolgrade";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/runs/route";
import {
  openBillingPortal,
  revokeApiKey,
  startCheckout,
} from "@/app/app/[org]/[project]/settings/actions";
import { Lift } from "@/components/status";
import { getDb } from "@/db/client";
import { apiKeys, organization, projects } from "@/db/schema";
import { generateApiKey } from "@/lib/api-keys";
import { MAX_UPLOAD_BYTES, UploadSchema } from "@/lib/ingest";
import { notesAgent } from "../../examples/scripted-agent";
import { giveActivePlan } from "./helpers";

const SUITE = join(
  import.meta.dirname,
  "..",
  "..",
  "examples",
  "notes-suite.yaml",
);
let report: Awaited<ReturnType<typeof runSuite>>;
let key: string;

beforeAll(async () => {
  report = await runSuite(await loadSuite(SUITE), {
    provider: new ScriptedProvider(notesAgent),
    trials: 1,
    filter: "read",
  });
  const db = await getDb();
  const [org] = await db
    .insert(organization)
    .values({ slug: "rf", name: "Review fixes" })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ orgId: org!.id, slug: "p", name: "P" })
    .returning();
  await giveActivePlan(db, org!.id, "team", project!.id);
  const k = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: project!.id,
    name: "ci",
    prefix: k.prefix,
    hash: k.hash,
  });
  key = k.key;
});

/** A body streamed without content-length, like a chunked upload. */
function chunked(bytes: number, token: string) {
  const chunk = new Uint8Array(64 * 1024).fill(32);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= bytes) return c.close();
      sent += chunk.byteLength;
      c.enqueue(chunk);
    },
  });
  return new Request("http://localhost/api/v1/runs", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
    duplex: "half",
  } as RequestInit);
}

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("upload endpoint hardening", () => {
  it("rejects an unknown key before reading a large streamed body", async () => {
    const res = await POST(chunked(MAX_UPLOAD_BYTES * 2, generateApiKey().key));
    expect(res.status).toBe(401);
  });

  it("caps a streamed body by bytes for authenticated callers", async () => {
    const res = await POST(chunked(MAX_UPLOAD_BYTES + 128 * 1024, key));
    expect(res.status).toBe(413);
  });

  it("refuses NUL characters that Postgres cannot store", async () => {
    const res = await post(
      JSON.stringify({ report: { ...report, suite: "a\u0000b" } }),
    );
    expect(res.status).toBe(422);
  });
});

// biome-ignore lint/suspicious/noExplicitAny: intentional mutation helpers for schema rejection tests
type AnyRecord = Record<string, any>;

describe("report validation covers everything the pages render", () => {
  const bad = (mutate: (r: AnyRecord) => void) => {
    const r = structuredClone(report) as unknown as AnyRecord;
    mutate(r);
    return UploadSchema.safeParse({ report: r }).success;
  };

  it("accepts the real engine report", () => {
    expect(bad(() => undefined)).toBe(true);
  });

  it.each([
    [
      "non-integer error count",
      (r: AnyRecord) => (r.overall.tools.trials.errors = 1.5),
    ],
    ["rate above 1", (r: AnyRecord) => (r.overall.tools.rate.high = 1.2)],
    ["missing gate checks", (r: AnyRecord) => delete r.gate.checks],
    ["missing per-task arm summary", (r: AnyRecord) => delete r.tasks[0].tools],
    [
      "object where a string is rendered",
      (r: AnyRecord) => (r.gate.checks[0].detail = { x: 1 }),
    ],
    ["null trial entry", (r: AnyRecord) => r.trials.push(null)],
    ["absurd trials per task", (r: AnyRecord) => (r.trialsPerTask = 2 ** 40)],
    ["overflowing cost", (r: AnyRecord) => (r.totalCostUsd = 1e12)],
  ])("rejects %s", (_name, mutate) => {
    expect(bad(mutate)).toBe(false);
  });

  it("fills defaults for fields older engines did not send", () => {
    const r = structuredClone(report) as unknown as AnyRecord;
    delete r.costIsLowerBound;
    for (const t of r.tasks) delete t.prompt;
    for (const t of r.trials) delete t.skipped;
    const parsed = UploadSchema.parse({ report: r });
    expect(parsed.report.costIsLowerBound).toBe(false);
    expect(parsed.report.trials.every((t) => Array.isArray(t.skipped))).toBe(
      true,
    );
  });
});

describe("server actions validate their arguments", () => {
  it("rejects malformed key ids and slugs without touching the database", async () => {
    expect(await revokeApiKey("rf", "p", "not-a-uuid")).toEqual({
      ok: false,
      error: "Unknown key.",
    });
    expect(
      await revokeApiKey("../x", "p", "00000000-0000-4000-8000-000000000000"),
    ).toEqual({
      ok: false,
      error: "Project not found, or you cannot manage its keys.",
    });
  });

  it("rejects a checkout for a malformed org/project slug without touching Stripe", async () => {
    // "../x" fails the slug format itself, so this is rejected before any session lookup -
    // like revokeApiKey's own malformed-slug case above (findManagedProject needs a request
    // context for getSession() that only a real request, not a unit test, can provide).
    expect(await startCheckout("../x", "p", "team")).toEqual({
      error: "Project not found, or you cannot manage its billing.",
    });
    expect(await startCheckout("../x", "p", "growth")).toEqual({
      error: "Organization not found, or you cannot manage its billing.",
    });
    expect(await startCheckout("x", "p", "free")).toEqual({
      error: "Not a paid plan.",
    });
    expect(await startCheckout("x", "p", "not-a-plan")).toEqual({
      error: "Not a paid plan.",
    });
  });

  it("rejects opening the billing portal for a malformed org slug", async () => {
    expect(await openBillingPortal("../x")).toEqual({
      error: "Organization not found, or you cannot manage its billing.",
    });
  });
});

describe("Lift", () => {
  it("never shows a direction arrow on a figure that rounds to zero", () => {
    const html = (v: number) =>
      renderToStaticMarkup(createElement(Lift, { value: v }));
    expect(html(-0.004)).toContain("0pp");
    expect(html(-0.004)).not.toContain("trending-down");
    expect(html(0.003)).not.toContain("trending-up");
    expect(html(0.12)).toContain("trending-up");
    expect(html(0.12)).toContain("+12pp");
  });
});
