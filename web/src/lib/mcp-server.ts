import "server-only";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  decodeRunCursor,
  getCompareRuns,
  getFailingAssertions,
  getLatestRun,
  getLiftTrend,
  getRunReport,
  getSuiteYaml,
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

  // --- Resources: addressable by URI rather than returned from a tool call, each scoped to
  // projectId with the same and(eq(projectId), eq(id)) check every tool above already uses, so a
  // runId for another project's run 404s exactly like it does for the tools. No `list` callback
  // (undefined, required by ResourceTemplate to make skipping listing explicit): a project can have
  // thousands of runs and there is no useful "list every resource" page to offer a client here.

  server.registerResource(
    "run_report",
    new ResourceTemplate("toolgrade://runs/{runId}/report", {
      list: undefined,
    }),
    {
      title: "Full run report",
      description:
        "The complete RunReport JSON for a run: every task's results and every trial's tool calls, not just a curated slice.",
      mimeType: "application/json",
    },
    async (uri, { runId }) => {
      const result = await getRunReport(db, projectId, String(runId));
      if (!result.found) {
        throw new McpError(ErrorCode.InvalidParams, `run not found: ${runId}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.report),
          },
        ],
      };
    },
  );

  server.registerResource(
    "run_suite",
    new ResourceTemplate("toolgrade://runs/{runId}/suite", {
      list: undefined,
    }),
    {
      title: "Run's suite YAML",
      description:
        "The suite file's raw YAML text as it was run, when the uploading CLI sent it. Runs uploaded before this feature shipped return a clear not-available notice instead of an error or empty text.",
      mimeType: "application/x-yaml",
    },
    async (uri, { runId }) => {
      const result = await getSuiteYaml(db, projectId, String(runId));
      if (!result.found) {
        throw new McpError(ErrorCode.InvalidParams, `run not found: ${runId}`);
      }
      if (result.suiteYaml === null) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "suite YAML not available: this run was uploaded before ToolGrade started storing the suite file's text.",
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/x-yaml",
            text: result.suiteYaml,
          },
        ],
      };
    },
  );

  return server;
}
