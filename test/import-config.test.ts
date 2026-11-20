import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSuite } from "../src/config.js";
import { detectClientConfigs, parseClientConfig, scaffoldSuiteFromImport } from "../src/import-config.js";

let dir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toolgrade-import-"));
  originalHome = process.env.HOME;
  process.env.HOME = dir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(dir, { recursive: true, force: true });
});

const MCP_SERVERS_SHAPE = {
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], env: { FOO: "bar" } },
    notes: { command: "node", args: ["server.js"] },
  },
};

describe("detectClientConfigs", () => {
  it("finds nothing in an empty home/cwd", async () => {
    expect(await detectClientConfigs(dir)).toEqual([]);
  });

  it("reports every known config location that exists on disk", async () => {
    await mkdir(join(dir, "Library", "Application Support", "Claude"), { recursive: true });
    await writeFile(join(dir, "Library", "Application Support", "Claude", "claude_desktop_config.json"), "{}");
    await writeFile(join(dir, ".mcp.json"), "{}");
    const found = await detectClientConfigs(dir);
    expect(found.map((f) => f.client)).toEqual(expect.arrayContaining(["claude-desktop", "claude-code"]));
    expect(found.find((f) => f.client === "claude-code")?.path).toBe(join(dir, ".mcp.json"));
  });
});

describe("parseClientConfig", () => {
  it("reads claude-desktop's mcpServers shape from an explicit path", async () => {
    const path = join(dir, "claude_desktop_config.json");
    await writeFile(path, JSON.stringify(MCP_SERVERS_SHAPE));
    const servers = await parseClientConfig("claude-desktop", path);
    expect(servers).toEqual([
      { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], env: { FOO: "bar" } },
      { name: "notes", command: "node", args: ["server.js"] },
    ]);
  });

  it("throws a clear error when the claude-desktop config is missing", async () => {
    await expect(parseClientConfig("claude-desktop", join(dir, "nope.json"))).rejects.toThrow(/not found/);
  });

  it("throws when the config has no servers with a command", async () => {
    const path = join(dir, "empty.json");
    await writeFile(path, JSON.stringify({ mcpServers: {} }));
    await expect(parseClientConfig("claude-desktop", path)).rejects.toThrow(/no servers/);
  });

  it("reads claude-code's project-local .mcp.json", async () => {
    await writeFile(join(dir, ".mcp.json"), JSON.stringify(MCP_SERVERS_SHAPE));
    const servers = await parseClientConfig("claude-code", undefined, dir);
    expect(servers.map((s) => s.name)).toEqual(["filesystem", "notes"]);
  });

  it("falls back to ~/.claude.json's per-project mcpServers when there is no local .mcp.json", async () => {
    await writeFile(
      join(dir, ".claude.json"),
      JSON.stringify({ projects: { [dir]: { mcpServers: { notes: { command: "node", args: ["server.js"] } } } } }),
    );
    const servers = await parseClientConfig("claude-code", undefined, dir);
    expect(servers).toEqual([{ name: "notes", command: "node", args: ["server.js"] }]);
  });

  it("reads cursor's .cursor/mcp.json (project-local, then user-level)", async () => {
    await mkdir(join(dir, "project", ".cursor"), { recursive: true });
    await writeFile(join(dir, "project", ".cursor", "mcp.json"), JSON.stringify(MCP_SERVERS_SHAPE));
    const servers = await parseClientConfig("cursor", undefined, join(dir, "project"));
    expect(servers.map((s) => s.name)).toEqual(["filesystem", "notes"]);
  });

  it("reads VS Code's servers key (not mcpServers)", async () => {
    await mkdir(join(dir, ".vscode"), { recursive: true });
    await writeFile(
      join(dir, ".vscode", "mcp.json"),
      JSON.stringify({ servers: { notes: { command: "node", args: ["server.js"] } } }),
    );
    const servers = await parseClientConfig("vscode", undefined, dir);
    expect(servers).toEqual([{ name: "notes", command: "node", args: ["server.js"] }]);
  });

  it("rejects malformed JSON with a clear error", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, "{ not json");
    await expect(parseClientConfig("claude-desktop", path)).rejects.toThrow(/not valid JSON/);
  });
});

describe("scaffoldSuiteFromImport", () => {
  it("reuses toolgrade init's suite scaffolding for an imported server", async () => {
    const notesServer = join(import.meta.dirname, "..", "examples", "notes-server", "server.ts");
    const out = join(dir, "toolgrade.yaml");
    await scaffoldSuiteFromImport({ name: "notes", command: "node", args: ["--import", "tsx", notesServer] }, out, "imported-notes");

    const { readFile } = await import("node:fs/promises");
    const yaml = await readFile(out, "utf8");
    expect(yaml).toContain("# Generated by `toolgrade init`");
    const { parse } = await import("yaml");
    const suite = parseSuite(parse(yaml), dir);
    expect(suite.name).toBe("imported-notes");
    expect(suite.tasks.length).toBeGreaterThan(1);
  });
});
