#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { compareRuns } from "./compare.js";
import { loadSuite } from "./config.js";
import { fingerprintSurface } from "./fingerprint.js";
import { writeOtelExport } from "./export/otel.js";
import { detectClientConfigs, parseClientConfig, scaffoldSuiteFromImport, type ClientName } from "./import-config.js";
import { generateSuite, type InitServer } from "./init.js";
import { lintSpecCompliance, lintToolDescriptions, lintTools, lintToolSafety } from "./lint.js";
import { openSession } from "./mcp.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAICompatibleProvider } from "./providers/openai.js";
import type { ModelProvider } from "./providers/types.js";
import { formatComparison, formatLint, formatMarkdown, formatTerminal } from "./report.js";
import { runSuite, type RunReport } from "./runner.js";
import { lintSuiteValidity } from "./suite-lint.js";
import { detectGitMeta, fetchBaseline, uploadReport } from "./upload.js";

const EXIT_GATE_FAILED = 1;
const EXIT_USAGE = 2;

const positiveInt = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
};

const program = new Command()
  .name("toolgrade")
  .description("Eval-first quality gates for MCP servers: does your tool surface beat a no-tool baseline?")
  .version("0.1.0");

program
  .command("run")
  .description("run a suite: every task x {with tools, no tools} x N trials, then apply the gate")
  .argument("<suite>", "suite YAML file")
  .option("-t, --trials <n>", "trials per task per arm (overrides suite)", positiveInt)
  .option("-c, --concurrency <n>", "parallel trials (overrides suite)", positiveInt)
  .option("-f, --filter <idOrTag>", "only run tasks with this id or tag")
  .option("--no-baseline", "skip the no-tool baseline arm")
  .option("-o, --out-dir <dir>", "where run reports are written", ".toolgrade/runs")
  .option("--markdown <file>", "also write a Markdown summary (for PR comments)")
  .option("--otel-export <file>", "also write the run as OTel GenAI spans, OTLP/JSON wire format (for Jaeger/Langfuse/Phoenix)")
  .option("--compare <report>", "compare against a previous run report; regression fails the run")
  .option("--baseline <url>", "compare against the most recent matching run on a ToolGrade platform instead of --compare (key from TOOLGRADE_API_KEY)")
  .option("--baseline-branch <branch>", "only match a baseline from this branch (default: the PR base branch in GitHub Actions, otherwise any branch)")
  .option("--provider <name>", "anthropic, or openai for any OpenAI-compatible endpoint (Ollama, OpenAI, Gemini, Groq...)", "anthropic")
  .option("--base-url <url>", "endpoint for --provider openai", "http://localhost:11434/v1")
  .option("--api-key-env <var>", "env var holding the key for --provider openai (Ollama needs none)", "OPENAI_API_KEY")
  .option("--local-model", "the model runs on your own hardware: price it at $0")
  .option("--request-timeout <seconds>", "per model call, for --provider openai (slow local hardware needs more)", positiveInt, 300)
  .option("-m, --model <id>", "agent model (overrides the suite)")
  .option("--judge-model <id>", "judge model (overrides the suite; defaults to --model when that is given)")
  .option("--upload <url>", "upload the report to a ToolGrade platform (key from TOOLGRADE_API_KEY)")
  .action(async (suitePath: string, o) => {
    const suite = await loadSuite(suitePath);
    if (o.model) {
      suite.agent.model = o.model;
      suite.judge.model = o.model;
    }
    if (o.judgeModel) suite.judge.model = o.judgeModel;
    // Local inference has no API bill; price it at zero unless the suite says otherwise.
    // --local-model covers local servers on other hostnames (e.g. a container named tg-ollama).
    if (o.provider === "openai" && (o.localModel || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(o.baseUrl))) {
      for (const m of [suite.agent.model, suite.judge.model]) suite.pricing[m] ??= { input: 0, output: 0 };
    }
    if (o.compare && o.baseline) throw new InvalidArgumentError("use either --compare or --baseline, not both");
    const apiKey = process.env.TOOLGRADE_API_KEY;
    if ((o.upload || o.baseline) && !apiKey) throw new InvalidArgumentError("--upload/--baseline need TOOLGRADE_API_KEY (create one in the project's settings)");
    const previous = o.compare
      ? await readReport(o.compare)
      : o.baseline
        ? await fetchBaseline(o.baseline, apiKey!, { suite: suite.name, branch: o.baselineBranch ?? process.env.GITHUB_BASE_REF })
        : undefined;
    const report = await runSuite(suite, {
      provider: makeProvider(o),
      trials: o.trials,
      concurrency: o.concurrency,
      // commander defaults a --no-* flag to true; only override the suite when the flag was given.
      baseline: o.baseline === false ? false : undefined,
      filter: o.filter,
      onTrial: (t, done, total) => {
        const mark = t.error ? "!" : t.passed ? "." : "x";
        process.stderr.write(`\r${done}/${total} trials ${mark}`);
        if (done === total) process.stderr.write("\n");
      },
    });

    await mkdir(o.outDir, { recursive: true });
    const file = join(o.outDir, `${report.startedAt.replace(/[:.]/g, "-")}.json`);
    const json = JSON.stringify(report, null, 2);
    await writeFile(file, json);
    await writeFile(join(o.outDir, "latest.json"), json);

    console.log(formatTerminal(report));
    const cmp = previous ? compareRuns(previous, report) : undefined;
    if (cmp) console.log(`\n${formatComparison(cmp)}`);
    if (o.markdown) await writeFile(o.markdown, formatMarkdown(report, cmp));
    if (o.otelExport) await writeOtelExport(report, o.otelExport);
    console.log(`\nReport: ${file}`);
    if (o.upload) {
      const uploaded = await uploadReport(o.upload, apiKey!, report, await detectGitMeta());
      console.log(`Uploaded: ${uploaded.url}`);
    }

    if (!report.gate.passed || cmp?.verdict === "regressed") process.exitCode = EXIT_GATE_FAILED;
  });

program
  .command("inspect")
  .description("connect to the suite's server, list its tools and lint their definitions (no model calls)")
  .argument("<suite>", "suite YAML file")
  .action(async (suitePath: string) => {
    const suite = await loadSuite(suitePath);
    const session = await openSession(suite.server);
    try {
      for (const t of session.tools) console.log(`- ${t.name}: ${t.description?.split("\n")[0] ?? "(no description)"}`);
      console.log("");
      const issues = lintTools(session.tools);
      console.log(formatLint(issues, session.tools.length));
      // Description quality scores
      const qualityResults = lintToolDescriptions(session.tools);
      if (qualityResults.length > 0) {
        console.log("\nDescription quality scores (0–100):");
        for (const r of qualityResults) {
          const bar = "█".repeat(Math.round(r.score / 10)).padEnd(10, "░");
          console.log(`  ${r.toolName.padEnd(32)} ${bar} ${r.score}`);
          for (const issue of r.issues) console.log(`    ⚠ ${issue}`);
        }
      }
      // Safety / destructive-action findings
      const safetyFindings = lintToolSafety(session.tools);
      if (safetyFindings.length > 0) {
        console.log("\nSafety findings:");
        for (const f of safetyFindings) {
          const tag = f.severity === "danger" ? "danger" : f.severity === "warn" ? "warn  " : "info  ";
          console.log(`  ${tag} ${f.toolName}: ${f.message}`);
        }
      }

      // Spec compliance score
      const { results: complianceResults, compliancePercent } = lintSpecCompliance(session.tools);
      console.log(`\nMCP spec compliance: ${compliancePercent}%`);
      for (const r of complianceResults) {
        if (!r.compliant) console.log(`  ${r.toolName}: missing ${r.missing.join(", ")}`);
      }

      // Suite task-design validity (same suite the server was loaded from, since tasks are required)
      const suiteFindings = lintSuiteValidity(suite);
      if (suiteFindings.length > 0) {
        console.log("\nSuite validity findings:");
        for (const f of suiteFindings) console.log(`  ${f.severity === "warn" ? "warn  " : "info  "} ${f.taskId}: ${f.message}`);
      }

      console.log(`\nTool surface fingerprint: ${fingerprintSurface(session.tools)}`);
      if (issues.some((i) => i.level === "error")) process.exitCode = EXIT_GATE_FAILED;
    } finally {
      await session.close();
    }
  });

program
  .command("init")
  .description("connect to a server, read its tools and write a starter suite (e.g. toolgrade init -- node dist/server.js)")
  .argument("[command...]", "command that starts a stdio server; put it after --")
  .option("--url <url>", "connect to a Streamable HTTP server instead")
  .option("-o, --out <file>", "suite file to write", "toolgrade.yaml")
  .option("--name <name>", "suite name", basename(process.cwd()))
  .option("--force", "overwrite an existing suite file")
  .action(async (command: string[], o) => {
    if (!o.url && command.length === 0) throw new InvalidArgumentError("give a server command after -- or --url");
    if (!o.force && (await exists(o.out))) throw new InvalidArgumentError(`${o.out} exists; pass --force to overwrite`);
    const outDir = dirname(resolve(o.out));
    const [cmd, ...args] = command;
    const server: InitServer = o.url
      ? { url: o.url }
      : { command: cmd!, args, cwd: relative(outDir, process.cwd()) || "." };
    const session = await openSession(o.url ? { url: o.url, headers: {} } : { command: cmd!, args, cwd: process.cwd(), env: {} });
    try {
      await writeFile(o.out, generateSuite(o.name, server, session.tools));
      console.log(`Wrote ${o.out}: ${session.tools.length} tool task(s) + 1 control task.`);
      console.log(formatLint(lintTools(session.tools), session.tools.length));
      console.log(`\nNext: replace the TODO prompts and rubrics, then: toolgrade run ${o.out}`);
    } finally {
      await session.close();
    }
  });

const CLIENT_NAMES: ClientName[] = ["claude-desktop", "claude-code", "cursor", "vscode"];

program
  .command("import")
  .description("scaffold a suite from an MCP server already configured in an AI client (e.g. toolgrade import --from cursor)")
  .option("--from <client>", `client to read config from (${CLIENT_NAMES.join(", ")})`)
  .option("--path <file>", "explicit config file path (overrides the client's default location)")
  .option("--server <name>", "server name to import, when the config has more than one")
  .option("-o, --out <file>", "suite file to write", "toolgrade.yaml")
  .option("--name <name>", "suite name", basename(process.cwd()))
  .option("--force", "overwrite an existing suite file")
  .option("--detect", "just report which client configs exist on this machine, and exit")
  .action(async (o) => {
    if (o.detect) {
      const found = await detectClientConfigs();
      if (found.length === 0) {
        console.log("No known MCP client configs found on this machine.");
        return;
      }
      console.log("Found MCP client configs:");
      for (const f of found) console.log(`  ${f.client}: ${f.path}`);
      return;
    }
    if (!o.from) throw new InvalidArgumentError(`--from is required (one of: ${CLIENT_NAMES.join(", ")}), or pass --detect`);
    if (!CLIENT_NAMES.includes(o.from)) throw new InvalidArgumentError(`unknown --from "${o.from}" (use: ${CLIENT_NAMES.join(", ")})`);
    if (!o.force && (await exists(o.out))) throw new InvalidArgumentError(`${o.out} exists; pass --force to overwrite`);

    const servers = await parseClientConfig(o.from as ClientName, o.path);
    let server = servers[0];
    if (servers.length > 1) {
      if (!o.server) {
        console.error(`${o.from} has ${servers.length} configured servers; re-run with --server <name>:`);
        for (const s of servers) console.error(`  - ${s.name}`);
        process.exitCode = EXIT_USAGE;
        return;
      }
      const match = servers.find((s) => s.name === o.server);
      if (!match) throw new InvalidArgumentError(`no server named "${o.server}" in ${o.from} config (found: ${servers.map((s) => s.name).join(", ")})`);
      server = match;
    } else if (o.server && servers[0]?.name !== o.server) {
      throw new InvalidArgumentError(`no server named "${o.server}" in ${o.from} config (found: ${servers.map((s) => s.name).join(", ")})`);
    }
    if (!server) throw new Error(`${o.from} config defines no importable servers`);

    await scaffoldSuiteFromImport(server, o.out, o.name);
    console.log(`Imported "${server.name}" from ${o.from} (${server.command} ${server.args.join(" ")})`.trimEnd());
    console.log(`Wrote ${o.out}`);
    console.log(`\nNext: replace the TODO prompts and rubrics, then: toolgrade run ${o.out}`);
  });

program
  .command("upload")
  .description("upload an existing run report to a ToolGrade platform (key from TOOLGRADE_API_KEY)")
  .argument("<report>", "run report JSON, e.g. .toolgrade/runs/latest.json")
  .requiredOption("--url <url>", "platform origin, e.g. https://app.toolgrade.dev")
  .option("--message <text>", "label for the run, e.g. the commit message")
  .action(async (reportPath: string, o) => {
    const apiKey = process.env.TOOLGRADE_API_KEY;
    if (!apiKey) throw new InvalidArgumentError("set TOOLGRADE_API_KEY (create one in the project's settings)");
    const meta = { ...(await detectGitMeta()), ...(o.message ? { commitMessage: o.message } : {}) };
    const uploaded = await uploadReport(o.url, apiKey, await readReport(reportPath), meta);
    console.log(`Uploaded: ${uploaded.url}`);
  });

program
  .command("compare")
  .description("compare two run reports and flag statistically significant regressions")
  .argument("<before>", "earlier run report JSON")
  .argument("<after>", "later run report JSON")
  .action(async (beforePath: string, afterPath: string) => {
    const cmp = compareRuns(await readReport(beforePath), await readReport(afterPath));
    console.log(formatComparison(cmp));
    if (cmp.verdict === "regressed") process.exitCode = EXIT_GATE_FAILED;
  });

function makeProvider(o: { provider: string; baseUrl: string; apiKeyEnv: string; requestTimeout: number }): ModelProvider {
  if (o.provider === "anthropic") return new AnthropicProvider();
  if (o.provider === "openai") return new OpenAICompatibleProvider({ baseUrl: o.baseUrl, apiKey: process.env[o.apiKeyEnv], timeoutMs: o.requestTimeout * 1000 });
  throw new InvalidArgumentError(`unknown provider "${o.provider}" (use anthropic or openai)`);
}

const exists = (path: string) => access(path).then(() => true, () => false);

async function readReport(path: string): Promise<RunReport> {
  const report = JSON.parse(await readFile(path, "utf8")) as RunReport;
  if (report.version !== 1) throw new Error(`${path} is not a toolgrade v1 run report`);
  return report;
}

program.parseAsync().catch((err: unknown) => {
  console.error(`toolgrade: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = EXIT_USAGE;
});
