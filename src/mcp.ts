import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStdio, type ServerSpec, type StdioServerSpec } from "./config.js";

const { version: packageVersion } = createRequire(import.meta.url)("../package.json") as { version: string };

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** Behavior hints from the server (MCP spec: all hints, not guaranteed accurate). */
  annotations?: McpToolAnnotations;
  /** Declared shape of a successful call's structured result, when the server provides one. */
  outputSchema?: Record<string, unknown>;
}

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
}

export interface McpSession {
  tools: McpTool[];
  /** This session's private sandbox directory, when the suite uses a fixture or ${TRIAL_DIR}. */
  trialDir?: string;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  close(): Promise<void>;
}

export const TRIAL_DIR = "${TRIAL_DIR}";

/**
 * A fresh, private directory for one session: a copy of the suite's fixture (or empty when the
 * suite only references ${TRIAL_DIR}). Real path, so servers that canonicalise paths agree.
 */
async function prepareTrialDir(server: StdioServerSpec): Promise<string | undefined> {
  const uses = [server.cwd ?? "", ...server.args, ...Object.values(server.env)].some((v) => v.includes(TRIAL_DIR));
  if (!server.fixture && !uses) return undefined;
  const dir = await realpath(await mkdtemp(join(tmpdir(), "toolgrade-trial-")));
  if (server.fixture) await cp(server.fixture, dir, { recursive: true });
  return dir;
}

const fill = (value: string, dir: string | undefined) => (dir ? value.replaceAll(TRIAL_DIR, dir) : value);

export async function openSession(server: ServerSpec): Promise<McpSession> {
  const client = new Client({ name: "toolgrade", version: packageVersion });
  const trialDir = isStdio(server) ? await prepareTrialDir(server) : undefined;
  const cleanup = async () => {
    if (trialDir) await rm(trialDir, { recursive: true, force: true });
  };
  const transport = isStdio(server)
    ? new StdioClientTransport({
        command: server.command,
        args: server.args.map((a) => fill(a, trialDir)),
        cwd: server.cwd ? fill(server.cwd, trialDir) : undefined,
        // Minimal inherited env on purpose: the server under test must not see our model API key.
        env: { ...getDefaultEnvironment(), ...Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, fill(v, trialDir)])) },
        stderr: "ignore",
      })
    : new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      });

  try {
    await client.connect(transport);
    if (!isStdio(server) && server.reset) await callTool(client, server.reset.tool, server.reset.args);
    const tools = await listAllTools(client);
    return {
      tools,
      trialDir,
      callTool: (name, args) => callTool(client, name, args),
      close: async () => {
        await client.close();
        await cleanup();
      },
    };
  } catch (err) {
    await client.close().catch(() => undefined);
    await cleanup();
    throw err;
  }
}

async function listAllTools(client: Client): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const t of page.tools) {
      tools.push({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        annotations: t.annotations as McpToolAnnotations | undefined,
        outputSchema: t.outputSchema as Record<string, unknown> | undefined,
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

interface ContentPart {
  type: string;
  text?: string;
  mimeType?: string;
  uri?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
}

// Binary payloads become short placeholders: base64 inlined as text would blow up the context
// and grade nothing. Image blocks are not forwarded to the model in this version.
function describeContent(c: ContentPart): string {
  switch (c.type) {
    case "text":
      return c.text ?? "";
    case "image":
    case "audio":
      return `[${c.type} content: ${c.mimeType ?? "unknown type"}, not shown]`;
    case "resource":
      return c.resource?.text ?? `[embedded resource ${c.resource?.uri ?? ""} (${c.resource?.mimeType ?? "binary"}), not shown]`;
    case "resource_link":
      return `[resource link: ${c.uri ?? ""}]`;
    default:
      return `[${c.type} content, not shown]`;
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.map(describeContent).join("\n");
    return { text, isError: result.isError === true };
  } catch (err) {
    return { text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

