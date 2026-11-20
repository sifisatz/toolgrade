import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { generateSuite, type InitServer } from "./init.js";
import { openSession } from "./mcp.js";

export type ClientName = "claude-desktop" | "claude-code" | "cursor" | "vscode";

export interface ImportedServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface RawMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** `{ mcpServers: { <name>: { command, args, env } } }` - used by Claude Desktop, Claude Code's .mcp.json, and Cursor. */
interface McpServersShape {
  mcpServers?: Record<string, RawMcpServer>;
}

/** VS Code's `.vscode/mcp.json` uses a `servers` key instead of `mcpServers`. */
interface VsCodeServersShape {
  servers?: Record<string, RawMcpServer>;
}

/** `~/.claude.json` keeps per-project config under `projects[<absolute cwd>].mcpServers`. */
interface ClaudeUserConfigShape {
  projects?: Record<string, { mcpServers?: Record<string, RawMcpServer> }>;
}

/** Exported for tests: the current platform's real claude-desktop config path. */
export function platformPaths(): { claudeDesktop: string } {
  const home = homedir();
  if (process.platform === "darwin") {
    return { claudeDesktop: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json") };
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return { claudeDesktop: join(appData, "Claude", "claude_desktop_config.json") };
  }
  return { claudeDesktop: join(home, ".config", "Claude", "claude_desktop_config.json") };
}

/** Every location `parseClientConfig` knows how to read, keyed by client name, in the order they're checked. */
function candidateLocations(cwd: string): Array<{ client: ClientName; path: string }> {
  const { claudeDesktop } = platformPaths();
  const home = homedir();
  return [
    { client: "claude-desktop", path: claudeDesktop },
    { client: "claude-code", path: join(cwd, ".mcp.json") },
    { client: "claude-code", path: join(home, ".claude.json") },
    { client: "cursor", path: join(cwd, ".cursor", "mcp.json") },
    { client: "cursor", path: join(home, ".cursor", "mcp.json") },
    { client: "vscode", path: join(cwd, ".vscode", "mcp.json") },
  ];
}

/** Probes every known client config location and reports which ones actually exist on this machine. */
export async function detectClientConfigs(cwd: string = process.cwd()): Promise<Array<{ client: ClientName; path: string }>> {
  const found: Array<{ client: ClientName; path: string }> = [];
  for (const loc of candidateLocations(cwd)) {
    if (await exists(loc.path)) found.push(loc);
  }
  return found;
}

function toImportedServers(raw: Record<string, RawMcpServer> | undefined): ImportedServer[] {
  if (!raw) return [];
  return Object.entries(raw)
    .filter((entry): entry is [string, RawMcpServer & { command: string }] => typeof entry[1].command === "string")
    .map(([name, s]) => ({ name, command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) }));
}

/**
 * Reads the MCP server list for a given client. `explicitPath` overrides the default location
 * (useful for `claude-code`'s project-local `.mcp.json` when run outside that project, or any
 * non-standard install). `cwd` defaults to `process.cwd()`; tests pass a temp directory instead
 * of touching the real project or user config. Throws a clear error if the file is missing or
 * defines no servers.
 */
export async function parseClientConfig(source: ClientName, explicitPath?: string, cwd: string = process.cwd()): Promise<ImportedServer[]> {
  if (source === "claude-code" && !explicitPath) {
    // Project-local .mcp.json takes priority; fall back to ~/.claude.json's per-project entry.
    const localPath = join(cwd, ".mcp.json");
    if (await exists(localPath)) return parseMcpServersFile(localPath);
    const userConfigPath = join(homedir(), ".claude.json");
    if (await exists(userConfigPath)) {
      const data = await readJson<ClaudeUserConfigShape>(userConfigPath);
      const project = data.projects?.[cwd];
      const servers = toImportedServers(project?.mcpServers);
      if (servers.length === 0) {
        throw new Error(`no MCP servers found for ${cwd} in ${userConfigPath}, and no .mcp.json in the current directory`);
      }
      return servers;
    }
    throw new Error(`no .mcp.json in ${cwd} and no ${userConfigPath}`);
  }

  if (source === "cursor" && !explicitPath) {
    const localPath = join(cwd, ".cursor", "mcp.json");
    if (await exists(localPath)) return parseMcpServersFile(localPath);
    const userPath = join(homedir(), ".cursor", "mcp.json");
    if (await exists(userPath)) return parseMcpServersFile(userPath);
    throw new Error(`no cursor MCP config found at ${localPath} or ${userPath}`);
  }

  if (source === "claude-desktop") {
    const path = explicitPath ?? platformPaths().claudeDesktop;
    if (!(await exists(path))) throw new Error(`claude desktop config not found at ${path}`);
    return parseMcpServersFile(path);
  }

  if (source === "vscode") {
    const path = explicitPath ?? join(cwd, ".vscode", "mcp.json");
    if (!(await exists(path))) throw new Error(`vscode MCP config not found at ${path}`);
    const data = await readJson<VsCodeServersShape>(path);
    const servers = toImportedServers(data.servers);
    if (servers.length === 0) throw new Error(`${path} defines no servers with a "command" (remote/sse servers are not importable)`);
    return servers;
  }

  if (explicitPath) return parseMcpServersFile(explicitPath);
  throw new Error(`unknown client "${source}" (use claude-desktop, claude-code, cursor, or vscode)`);
}

async function parseMcpServersFile(path: string): Promise<ImportedServer[]> {
  const data = await readJson<McpServersShape>(path);
  const servers = toImportedServers(data.mcpServers);
  if (servers.length === 0) throw new Error(`${path} defines no servers with a "command" (remote/sse servers are not importable)`);
  return servers;
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const exists = (path: string) => access(path).then(() => true, () => false);

/**
 * Connects to the imported server to list its tools, then writes a starter suite via the same
 * scaffolding `toolgrade init` uses (`generateSuite`) - so an imported config produces an
 * identical suite shape to running `toolgrade init -- <command> <args>` by hand.
 */
export async function scaffoldSuiteFromImport(server: ImportedServer, outputPath: string, suiteName: string = basename(process.cwd())): Promise<void> {
  const initServer: InitServer = { command: server.command, args: server.args, cwd: "." };
  const session = await openSession({ command: server.command, args: server.args, cwd: process.cwd(), env: server.env ?? {} });
  try {
    await writeFile(outputPath, generateSuite(suiteName, initServer, session.tools));
  } finally {
    await session.close();
  }
}
