import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("db client", () => {
  it("refuses to fall back to PGlite in production without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    process.env.VERCEL_ENV = "production";
    const { dbHandle } = await import("@/db/client");
    expect(() => dbHandle()).toThrow(/DATABASE_URL/);
  });

  it("still allows PGlite outside production", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL_ENV;
    process.env.PGLITE_DIR = "memory://";
    const { dbHandle } = await import("@/db/client");
    expect(() => dbHandle()).not.toThrow();
  });
});

describe("refusesPgliteFallback", () => {
  // Exercised as a pure function, not through dbHandle(): Vitest pins process.env.NODE_ENV to
  // "test" for the whole run, so reassigning it inside a test (as the suite above does for
  // VERCEL_ENV) never reaches code that reads it - only passing a literal env object does.
  it("refuses on Vercel production", async () => {
    const { refusesPgliteFallback } = await import("@/db/client");
    expect(refusesPgliteFallback({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("refuses on a non-Vercel production host via NODE_ENV", async () => {
    const { refusesPgliteFallback } = await import("@/db/client");
    expect(refusesPgliteFallback({ NODE_ENV: "production" })).toBe(true);
  });

  it("allows PGlite outside production", async () => {
    const { refusesPgliteFallback } = await import("@/db/client");
    expect(refusesPgliteFallback({ NODE_ENV: "development" })).toBe(false);
    expect(refusesPgliteFallback({ VERCEL_ENV: "preview" })).toBe(false);
    expect(refusesPgliteFallback({})).toBe(false);
  });

  it("allows PGlite during `next build`'s static-generation pass, even under NODE_ENV=production", async () => {
    const { refusesPgliteFallback } = await import("@/db/client");
    expect(
      refusesPgliteFallback({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(false);
    expect(
      refusesPgliteFallback({
        VERCEL_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(false);
  });

  it("still refuses once the build phase ends and the server is actually running", async () => {
    const { refusesPgliteFallback } = await import("@/db/client");
    expect(
      refusesPgliteFallback({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-server",
      }),
    ).toBe(true);
  });
});
