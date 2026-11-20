import { describe, expect, it, vi } from "vitest";
import { fetchBaseline, uploadReport } from "../src/upload.js";

function stubFetch(status: number, body: unknown) {
  return vi.fn(async (input: string | URL) => {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, statusText: String(input) });
  }) as unknown as typeof fetch;
}

describe("fetchBaseline", () => {
  it("returns the report on success and sends suite/branch as query params", async () => {
    const report = { version: 1 };
    const fetchFn = stubFetch(200, { id: "r1", report });
    const result = await fetchBaseline("https://app.toolgrade.dev", "tg_abc", { suite: "my-suite", branch: "main" }, fetchFn);
    expect(result).toEqual(report);
    const url = new URL(vi.mocked(fetchFn).mock.calls[0]![0] as unknown as string);
    expect(url.pathname).toBe("/api/v1/runs/latest");
    expect(url.searchParams.get("suite")).toBe("my-suite");
    expect(url.searchParams.get("branch")).toBe("main");
  });

  it("omits branch when not given", async () => {
    const fetchFn = stubFetch(200, { id: "r1", report: { version: 1 } });
    await fetchBaseline("https://app.toolgrade.dev", "tg_abc", { suite: "my-suite" }, fetchFn);
    const url = new URL(vi.mocked(fetchFn).mock.calls[0]![0] as unknown as string);
    expect(url.searchParams.has("branch")).toBe(false);
  });

  it("treats 404 as no baseline yet, not an error", async () => {
    const fetchFn = stubFetch(404, { error: "no matching run found" });
    const result = await fetchBaseline("https://app.toolgrade.dev", "tg_abc", { suite: "my-suite" }, fetchFn);
    expect(result).toBeUndefined();
  });

  it("throws on other failures", async () => {
    const fetchFn = stubFetch(401, { error: "invalid or revoked API key" });
    await expect(fetchBaseline("https://app.toolgrade.dev", "tg_bad", { suite: "my-suite" }, fetchFn)).rejects.toThrow(/baseline fetch failed: 401/);
  });
});

describe("uploadReport", () => {
  const report = { version: 1 } as unknown as Parameters<typeof uploadReport>[2];

  it("omits suiteYaml from the body when not given", async () => {
    const fetchFn = stubFetch(201, { id: "r1", url: "https://app.toolgrade.dev/app/o/p/runs/r1" });
    await uploadReport("https://app.toolgrade.dev", "tg_abc", report, {}, fetchFn);
    const body = JSON.parse(vi.mocked(fetchFn).mock.calls[0]![1]!.body as string);
    expect(body).not.toHaveProperty("suiteYaml");
  });

  it("includes suiteYaml in the body when given", async () => {
    const fetchFn = stubFetch(201, { id: "r1", url: "https://app.toolgrade.dev/app/o/p/runs/r1" });
    await uploadReport("https://app.toolgrade.dev", "tg_abc", report, {}, fetchFn, "name: my-suite\ntasks: []\n");
    const body = JSON.parse(vi.mocked(fetchFn).mock.calls[0]![1]!.body as string);
    expect(body.suiteYaml).toBe("name: my-suite\ntasks: []\n");
  });

  it("throws with the response body on failure", async () => {
    const fetchFn = stubFetch(422, { error: "not a toolgrade v1 run report" });
    await expect(uploadReport("https://app.toolgrade.dev", "tg_abc", report, {}, fetchFn)).rejects.toThrow(/upload failed: 422/);
  });
});
