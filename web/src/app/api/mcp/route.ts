import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/db/client";
import {
  authenticateApiKey,
  bearerToken,
  markApiKeyUsed,
} from "@/lib/api-keys";
import { logError, logInfo, logWarn, newRequestId } from "@/lib/logger";
import { createToolGradeMcpServer } from "@/lib/mcp-server";
import { checkRateLimit } from "@/lib/rate-limit";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const MCP_RATE_LIMIT = { windowSeconds: 60, max: 120 };

const rpcError = (code: number, message: string, status: number) =>
  json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

/**
 * MCP endpoint for the API key's own project - read-only, so the same key that uploads runs via
 * /api/v1/runs can also query them here. Stateless streamable HTTP: one McpServer + transport per
 * request, no session id, JSON responses rather than SSE (every tool here answers immediately).
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const category = "mcp";

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    logWarn("mcp rejected: missing or malformed bearer token", {
      requestId,
      category,
    });
    return rpcError(
      -32001,
      "missing or malformed API key (Authorization: Bearer tg_...)",
      401,
    );
  }

  const db = await getDb();
  const key = await authenticateApiKey(db, token);
  if (!key) {
    logWarn("mcp rejected: invalid or revoked API key", {
      requestId,
      category,
    });
    return rpcError(-32001, "invalid or revoked API key", 401);
  }

  const withinRate = await checkRateLimit(
    db,
    `mcp:${key.id}`,
    MCP_RATE_LIMIT.windowSeconds,
    MCP_RATE_LIMIT.max,
  );
  if (!withinRate) {
    logWarn("mcp rejected: rate limited", {
      requestId,
      category,
      projectId: key.projectId,
      durationMs: Date.now() - startedAt,
    });
    return rpcError(
      -32000,
      `too many requests for this API key - at most ${MCP_RATE_LIMIT.max} per ${MCP_RATE_LIMIT.windowSeconds}s`,
      429,
    );
  }

  const server = createToolGradeMcpServer(db, key.projectId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    await markApiKeyUsed(db, key.id);
    logInfo("mcp request handled", {
      requestId,
      category,
      projectId: key.projectId,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (err) {
    logError("mcp request failed", {
      requestId,
      category,
      projectId: key.projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return rpcError(-32603, "internal server error", 500);
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function GET() {
  return rpcError(
    -32000,
    "method not allowed - this endpoint only accepts POST",
    405,
  );
}

export async function DELETE() {
  return rpcError(
    -32000,
    "method not allowed - this endpoint does not support sessions",
    405,
  );
}
