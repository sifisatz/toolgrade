import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  drizzle as drizzlePglite,
  type PgliteDatabase,
} from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import postgres from "postgres";
import * as schema from "./schema";

/** Both drivers expose the same query builder; typed as the PGlite flavour. */
export type Db = PgliteDatabase<typeof schema>;

const migrationsFolder = join(process.cwd(), "drizzle");

/**
 * True when PGlite must not be used as a fallback: Vercel's filesystem (and any in-memory state)
 * does not survive past a single invocation, and any other production host would silently run an
 * unmigrated, single-process, throwaway DB instead of the real one - either way, falling back
 * would silently discard every write. Checked on two signals, both only at actual runtime:
 * VERCEL_ENV catches Vercel specifically (NODE_ENV there is "production" even in preview deploys,
 * so it can't tell preview from prod by itself); plain NODE_ENV catches every other host
 * (`next start`, Docker, Railway, Fly, bare Node). `next build`'s static-generation pass also runs
 * under NODE_ENV=production (CI builds this app without DATABASE_URL, relying on the PGlite
 * fallback to prerender), so NEXT_PHASE excludes that pass - this must only ever fire against a
 * server actually serving requests. A pure function of its env snapshot so every signal can be
 * exercised independently in tests, without depending on how NODE_ENV behaves inside the test
 * runner itself.
 */
export function refusesPgliteFallback(env: {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  NEXT_PHASE?: string;
}): boolean {
  if (env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return false;
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

function open(): { db: Db; ready: Promise<void> } {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Serverless: few connections per instance, and no prepared statements so a transaction-mode
    // pooler (Neon's "-pooler" host, PgBouncer) works. Migrations run once per deploy
    // (`pnpm db:migrate` in the build), not on every cold start where instances would race.
    const db = drizzlePostgres({
      client: postgres(url, { max: 3, prepare: false }),
      schema,
      casing: "snake_case",
    });
    const migrate = process.env.DB_MIGRATE_ON_CONNECT === "1";
    return {
      db: db as unknown as Db,
      ready: migrate
        ? migratePostgres(db, { migrationsFolder })
        : Promise.resolve(),
    };
  }
  // Zero-infra local mode: embedded Postgres (WASM), single connection, demo/dev only.
  if (refusesPgliteFallback(process.env)) {
    throw new Error(
      "DATABASE_URL is not set. PGlite is dev/demo-only and loses all data in production " +
        "(Vercel's filesystem does not persist between invocations, and no other host should run " +
        "it either) — set DATABASE_URL.",
    );
  }
  const dataDir =
    process.env.PGLITE_DIR ?? join(process.cwd(), ".data", "pglite");
  if (dataDir !== "memory://") mkdirSync(dataDir, { recursive: true });
  const db = drizzlePglite({
    client: new PGlite(dataDir),
    schema,
    casing: "snake_case",
  });
  return { db, ready: migratePglite(db, { migrationsFolder }) };
}

// One connection per process, surviving dev hot reloads.
const g = globalThis as unknown as {
  __toolgradeDb?: { db: Db; ready: Promise<void> };
};

/** Synchronous handle for libraries that need one at construction (Better Auth). Await getDb() before relying on the schema. */
export function dbHandle(): Db {
  g.__toolgradeDb ??= open();
  return g.__toolgradeDb.db;
}

export async function getDb(): Promise<Db> {
  dbHandle();
  const conn = g.__toolgradeDb!;
  try {
    await conn.ready;
  } catch (err) {
    g.__toolgradeDb = undefined;
    throw err;
  }
  return conn.db;
}

export { schema };
