import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  decodeRunCursor,
  getCompareRuns,
  getFailingAssertions,
  getLatestRun,
  getLiftTrend,
  getToolUsage,
  listRunsPage,
} from "@/lib/mcp-tools";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function notFound(what: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: `${what} not found` }),
      },
    ],
    isError: true,
  };
}

/**
 * One MCP server per request, its tools closed over the project an API key already
 * authenticated for - callers can never reach another project's data by passing a different id,
 * because there is no id parameter on any tool.
 */
export function createToolGradeMcpServer(db: Db, projectId: string): McpServer {
  const server = new McpServer({ name: "toolgrade", version: "1.0.0" });

  server.registerTool(
    "get_latest_run",
    {
      description:
        "The most recent completed evaluation run for this project: pass rate, lift, gate status, cost.",
      inputSchema: {
        suite: z
          .string()
          .optional()
          .describe("Filter to a specific suite file, e.g. toolgrade.yaml"),
      },
    },
    async ({ suite }) => {
      const result = await getLatestRun(db, projectId, suite);
      return result.found ? json(result.run) : notFound("run");
    },
  );

  server.registerTool(
    "get_lift_trend",
    {
      description:
        "Lift over the last N runs of a suite, oldest to newest, with a simple improving/stable/regressing read.",
      inputSchema: {
        suite: z.string().describe("Suite file name"),
        lastN: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ suite, lastN }) =>
      json(await getLiftTrend(db, projectId, suite, lastN)),
  );

  server.registerTool(
    "get_failing_assertions",
    {
      description:
        "Assertions that failed in a run (defaults to the latest run), grouped by task and assertion type.",
      inputSchema: {
        runId: z
          .string()
          .optional()
          .describe("Specific run id. Omit for the latest run."),
        suite: z
          .string()
          .optional()
          .describe("Only used to pick the latest run when runId is omitted."),
      },
    },
    async ({ runId, suite }) => {
      const result = await getFailingAssertions(db, projectId, {
        runId,
        suite,
      });
      return result.found
        ? json({
            runId: result.runId,
            failingAssertions: result.failingAssertions,
          })
        : notFound("run");
    },
  );

  server.registerTool(
    "compare_runs",
    {
      description:
        "Diffs two runs: lift/pass-rate deltas, per-task regressions and improvements, and whether the tool surface itself changed.",
      inputSchema: {
        baseRunId: z.string().describe("The reference (older) run"),
        headRunId: z.string().describe("The candidate (newer) run"),
      },
    },
    async ({ baseRunId, headRunId }) => {
      const result = await getCompareRuns(db, projectId, baseRunId, headRunId);
      return result.found
        ? json(result.comparison)
        : notFound("one or both runs");
    },
  );

  server.registerTool(
    "get_tool_usage",
    {
      description:
        "Per-tool call counts and error counts for a run (defaults to the latest), plus which declared tools were never called.",
      inputSchema: {
        runId: z
          .string()
          .optional()
          .describe("Specific run id. Omit for the latest run."),
      },
    },
    async ({ runId }) => {
      const result = await getToolUsage(db, projectId, runId);
      return result.found
        ? json({ runId: result.runId, tools: result.tools })
        : notFound("run");
    },
  );

  server.registerTool(
    "list_runs",
    {
      description: "Recent runs with summary stats, cursor-paginated.",
      inputSchema: {
        suite: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z
          .string()
          .optional()
          .describe("nextCursor from a previous call"),
      },
    },
    async ({ suite, limit, cursor }) =>
      json(
        await listRunsPage(db, projectId, {
          suite,
          limit,
          cursor: decodeRunCursor(cursor),
        }),
      ),
  );

  return server;
}
