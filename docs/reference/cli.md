# CLI Reference

Install the CLI via npm (Node.js 20+ required):

```bash
npm install -g toolgrade
# or use without installing:
npx toolgrade <command>
```

---

## Commands

### `toolgrade run <suite>`

Runs the evaluation suite against your MCP server.

```bash
toolgrade run toolgrade.yaml
toolgrade run toolgrade.yaml --trials 5 --filter write
```

**Arguments:**
- `<suite>` — path to the suite YAML file

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--trials <n>` | suite setting | Number of trials per task per arm |
| `--concurrency <n>` | suite setting | Parallel trial executions |
| `--filter <idOrTag>` | — | Only run tasks matching id or tag |
| `--no-baseline` | false | Skip the no-tools arm |
| `--out-dir <dir>` | `.toolgrade/runs` | Directory for JSON report output |
| `--markdown <file>` | — | Also write a Markdown summary |
| `--upload <url>` | — | Upload report to hosted platform |
| `--compare <report>` | — | Compare against a local report file |
| `--baseline <url>` | — | Compare against hosted platform's latest run |
| `--baseline-branch <branch>` | `GITHUB_BASE_REF` | Branch filter when fetching baseline |
| `--provider <name>` | `anthropic` | `anthropic` or `openai` |
| `--base-url <url>` | `http://localhost:11434/v1` | Endpoint for openai provider |
| `--api-key-env <var>` | `OPENAI_API_KEY` | Env var holding the openai provider key |
| `--local-model` | false | Report cost as $0 (for local models) |
| `--model <id>` | suite setting | Override agent model |
| `--judge-model <id>` | matches `--model` | Override judge model |

**Environment variables:**
- `ANTHROPIC_API_KEY` — required for `--provider anthropic`
- `OPENAI_API_KEY` (or value of `--api-key-env`) — required for `--provider openai`
- `TOOLGRADE_API_KEY` — required for `--upload` and `--baseline`

**Exit codes:**
- `0` — all gate checks passed (or no gates configured)
- `1` — one or more gate checks failed, or a comparison returned `regressed`

**Output files:**
- `.toolgrade/runs/<timestamp>.json` — full run report
- `.toolgrade/runs/latest.json` — symlink to the most recent report
- `<file>` (if `--markdown` given) — Markdown summary suitable for PR comments

---

### `toolgrade inspect <suite>`

Connects to your server, reads all tools, and lints their definitions. No model calls are made — this is fast and costs nothing.

```bash
toolgrade inspect toolgrade.yaml
```

**What it checks:**
- Tool names (naming conventions, length, reserved prefixes)
- Descriptions (completeness, minimum length, common mistakes)
- Parameter documentation (every parameter should have a description)

**Output includes:**
- Formatted table of all tools and their descriptions
- Per-tool lint warnings
- **Tool surface fingerprint** — a hash of all tool names, descriptions, and schemas

The fingerprint is stored in run reports and shown in the compare view when tools changed between runs.

**Exit codes:**
- `0` — no lint errors (warnings may be present)
- `1` — lint errors found

---

### `toolgrade init [-- <command>] [--url <url>]`

Connects to your server, reads its tools, and generates a starter `toolgrade.yaml` with one task stub per tool.

```bash
# Stdio server
toolgrade init -- node dist/server.js --port 3000

# HTTP server
toolgrade init --url http://localhost:3000/mcp

# With custom output file
toolgrade init --out my-suite.yaml -- node dist/server.js
```

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--url <url>` | — | HTTP MCP server URL (alternative to stdio command) |
| `--out <file>` | `toolgrade.yaml` | Output file path |

**What's generated:**
- One `TODO:` task stub per discovered tool
- A no-tool control task
- Sensible defaults for `agent`, `run`, and `gate`

All `TODO:` markers must be replaced before running. The generated file is a starting point, not a usable suite.

---

### `toolgrade upload <report>`

Uploads an existing run report JSON to a hosted ToolGrade platform instance.

```bash
toolgrade upload .toolgrade/runs/latest.json --url https://app.toolgrade.dev
```

**Flags:**

| Flag | Required | Description |
|---|---|---|
| `--url <url>` | ✅ | Platform origin to upload to |

**Environment variables:**
- `TOOLGRADE_API_KEY` — required

Equivalent to running with `--upload` on `toolgrade run`, but for reports already on disk.

---

### `toolgrade compare <before> <after>`

Statistically compares two run report JSON files and outputs a verdict.

```bash
toolgrade compare .toolgrade/runs/baseline.json .toolgrade/runs/latest.json
```

**What it outputs:**
- Overall verdict: `improved`, `no_significant_change`, or `regressed`
- Per-task verdicts with Bonferroni correction
- Tool surface diff warning if tool schemas changed

**Exit codes:**
- `0` — no regression (`improved` or `no_significant_change`)
- `1` — `regressed`

**Statistical method:**
- Newcombe hybrid score interval for lift comparison
- Bonferroni correction on per-task verdicts (α = 0.05 / number of tasks)

---

## Global flags

These flags work on all commands:

| Flag | Description |
|---|---|
| `--version` | Print version and exit |
| `--help` | Print help and exit |

---

## Report format

All run reports are JSON with `version: 1`. The structure:

```json
{
  "version": 1,
  "suite": "my-server",
  "timestamp": "2026-01-15T14:23:00.000Z",
  "provider": "anthropic",
  "agentModel": "claude-sonnet-5",
  "judgeModel": "claude-sonnet-5",
  "trialsPerTask": 3,
  "taskCount": 4,
  "passRate": 0.87,
  "passLow": 0.78,
  "passHigh": 0.96,
  "baselineRate": 0.23,
  "lift": 0.64,
  "liftLow": 0.47,
  "liftHigh": 0.77,
  "liftSignificance": "significant",
  "gatePassed": true,
  "totalCostUsd": 0.021,
  "toolSurfaceFingerprint": "sha256:...",
  "gateChecks": [...],
  "tasks": [...]
}
```

---

## Troubleshooting common errors

**`Error: ANTHROPIC_API_KEY is not set`**  
Set the environment variable before running: `export ANTHROPIC_API_KEY=sk-ant-...`

**`Error: Failed to connect to MCP server`**  
Check that your server command is correct and the server starts successfully. Test it manually: `node path/to/server.js` and check for startup errors.

**`Error: Suite validation failed`**  
Your `toolgrade.yaml` has a schema error. The error message includes the field path and what was expected. Run `toolgrade inspect` to validate without running evals.

**`Error: No tasks matched filter`**  
The `--filter` value doesn't match any task id or tag. Check task ids in your YAML.

**`Error: Upload failed: 401 Unauthorized`**  
Your `TOOLGRADE_API_KEY` is missing, wrong, or revoked. Create a new key in project Settings.

**`Error: Upload failed: 429 Too Many Requests`**  
You've hit the rate limit (30 uploads per minute per key). Wait a moment and retry.

**`Error: Upload failed: 402 Payment Required`**  
You've used all evaluation units for your plan this month. Check your usage in project Settings.
