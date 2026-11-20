import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RunReport } from "toolgrade/core";

const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid().primaryKey().defaultRandom();

// --- Better Auth (core + organization plugin). Keys are the camelCase field names Better Auth
// uses; the snake_case casing maps them to columns. Ids are uuid (advanced.database.generateId).

export const user = pgTable("user", {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: id(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: id(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const verification = pgTable("verification", {
  id: id(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The tenant. Every project, key and run hangs off an organization. */
export const organization = pgTable("organization", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  metadata: text(),
  createdAt: createdAt(),
});

export const member = pgTable(
  "member",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.userId), index().on(t.userId)],
);

/**
 * Shared by two independent users: Better Auth's own `rateLimit.storage: "database"` (session
 * endpoints, keyed by its own scheme) and our own ingest/baseline-fetch limiter in
 * lib/rate-limit.ts (keys prefixed "ingest:"/"baseline:" so the two can never collide). One table
 * instead of two, since both are the same shape: a key, a count, and when the window started.
 */
export const rateLimit = pgTable("rate_limit", {
  id: id(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
});

export const invitation = pgTable("invitation", {
  id: id(),
  organizationId: uuid()
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text().notNull(),
  role: text(),
  status: text().notNull().default("pending"),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  inviterId: uuid()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// --- ToolGrade

export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    repo: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.orgId, t.slug)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text().notNull(),
  /** First characters of the key, safe to display; the key itself is never stored. */
  prefix: text().notNull(),
  hash: text().notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    /** "cli" for uploaded runs, "demo" for seeded runs from the simulated agent. */
    source: text().notNull().default("cli"),
    suite: text().notNull(),
    provider: text().notNull(),
    agentModel: text().notNull(),
    judgeModel: text().notNull(),
    trialsPerTask: integer().notNull(),
    taskCount: integer().notNull(),
    passRate: doublePrecision().notNull(),
    passLow: doublePrecision().notNull(),
    passHigh: doublePrecision().notNull(),
    baselineRate: doublePrecision(),
    lift: doublePrecision(),
    liftLow: doublePrecision(),
    liftHigh: doublePrecision(),
    liftSignificance: text(),
    gatePassed: boolean().notNull(),
    errors: integer().notNull().default(0),
    totalCostUsd: numeric({ precision: 14, scale: 6, mode: "number" }),
    branch: text(),
    commit: text(),
    commitMessage: text(),
    /** See lib/usage.ts: one per (task, trial) where every arm that ran for it completed cleanly. */
    billableUnits: integer().notNull().default(0),
    report: jsonb().$type<RunReport>().notNull(),
    /**
     * The suite file's raw YAML text as the CLI ran it, when the uploading CLI sent it. Null for
     * any run uploaded before this column existed - never backfilled, so callers must treat null
     * as "not available" rather than inferring the suite from `report`.
     */
    suiteYaml: text("suite_yaml"),
    /** 1 = good, -1 = bad, null = not rated */
    annotationRating: integer("annotation_rating"),
    annotationNote: text("annotation_note"),
  },
  (t) => [index().on(t.projectId, t.createdAt)],
);

/**
 * A paid plan on an org (Growth) or a single project within it (Early Access, Team) - see
 * lib/entitlements.ts for what each plan actually grants. No row means the free plan: there is
 * nothing to bill and nothing hosted to entitle (local CLI only).
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Null for an org-level plan (Growth); set for a project-level plan (Early Access, Team). */
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    /** Billing provider, e.g. "stripe" - a field now so adding a second provider isn't a migration. */
    provider: text().notNull().default("stripe"),
    providerCustomerId: text(),
    providerSubscriptionId: text().unique(),
    plan: text().notNull(),
    status: text().notNull(),
    currentPeriodStart: timestamp({ withTimezone: true }),
    currentPeriodEnd: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId), index().on(t.projectId)],
);

/**
 * Every Stripe webhook event id we've processed, so a retried delivery (Stripe retries on
 * anything but a 2xx, and may also just send the same event twice) applies its effect at most
 * once. The id is the whole row - no other state needed to make "insert, if that fails we've seen
 * it already" work.
 */
export const stripeEvents = pgTable("stripe_events", {
  id: text().primaryKey(),
  createdAt: createdAt(),
});

/**
 * Append-only activation/growth-funnel log (org_created, project_created, api_key_created,
 * run_ingested, checkout_started, subscription_started - see lib/analytics.ts). No new
 * infrastructure: reuses the existing Postgres, same reasoning as rate_limit above. `properties`
 * stays small and non-sensitive by construction - ids and plan names already visible elsewhere in
 * the dashboard, never request bodies or free-text user content.
 */
export const productEvents = pgTable(
  "product_events",
  {
    id: id(),
    name: text().notNull(),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    organizationId: uuid().references(() => organization.id, {
      onDelete: "set null",
    }),
    projectId: uuid().references(() => projects.id, { onDelete: "set null" }),
    properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.name, t.createdAt)],
);

/**
 * Submissions from the public, unauthenticated "/design-partners" marketing form - not tied to a
 * user or org (most applicants have neither yet). Triaged by hand (see scripts/
 * design-partners-report.ts); `status` is simple free-form progress tracking, not a workflow
 * engine.
 */
export const designPartnerApplications = pgTable(
  "design_partner_applications",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    company: text(),
    mcpServer: text().notNull(),
    notes: text(),
    status: text().notNull().default("new"),
    createdAt: createdAt(),
  },
);

export type Org = typeof organization.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunInsert = typeof runs.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionInsert = typeof subscriptions.$inferInsert;
