// Minimal stateful HTTP MCP server for isolation tests: an in-memory counter shared across
// every connection, plus a "reset" tool - mirrors a real stateful service under test.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export function startCounterServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let count = 0;

  return new Promise((resolve) => {
    const httpServer = createServer(async (req, res) => {
      const mcp = new McpServer({ name: "counter-server", version: "0.0.0" });
      const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
      mcp.registerTool("increment", { description: "Increment the shared counter." }, async () => text(String(++count)));
      mcp.registerTool("get", { description: "Read the shared counter." }, async () => text(String(count)));
      mcp.registerTool("reset", { description: "Reset the shared counter to zero." }, async () => {
        count = 0;
        return text("reset");
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    });

    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise((r) => httpServer.close(() => r())),
      });
    });
  });
}
