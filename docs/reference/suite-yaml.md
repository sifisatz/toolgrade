# Suite YAML Reference

The `toolgrade.yaml` file defines everything about an evaluation run: how to connect to your server, which model to use as the agent, how many trials to run, what tasks to evaluate, and what gates to enforce.

---

## Full schema

```yaml
# Required: suite name, used in reports and baseline matching
name: my-server

# Optional: suite schema version (default: "1")
version: "1"

# ─── Server connection ────────────────────────────────────────────────────────

server:
  # Option A: stdio server (subprocess)
  command: node               # executable
  args: [dist/server.js]     # arguments array
  cwd: ..                     # working directory (relative to this file)
  env:                        # extra environment variables
    DATABASE_URL: postgres://localhost/test
  fixture: test-fixtures/     # directory to copy into $TRIAL_DIR per session

  # Option B: HTTP server
  # url: http://localhost:3000/mcp
  # headers:
  #   Authorization: Bearer test-token

# ─── Agent configuration ─────────────────────────────────────────────────────

agent:
  model: claude-sonnet-5      # model identifier
  system: |                   # optional system prompt injected before the task
    You are a helpful assistant. Use the available tools to complete tasks.
  max_turns: 10               # max conversation turns (default: 10)
  max_tokens: 16000           # max tokens per turn (default: 16000)
  max_tool_result_chars: 20000 # tool result truncated to this length (default: 20000)
  effort: medium              # extended thinking effort: low/medium/high/xhigh/max

# ─── Judge configuration ─────────────────────────────────────────────────────

judge:
  model: claude-sonnet-5      # model for LLM judge assertions (default: matches agent)

# ─── Run settings ─────────────────────────────────────────────────────────────

run:
  trials: 3                   # trials per task per arm (default: 3)
  baseline: true              # run no-tools arm (default: true)
  concurrency: 4              # parallel trial executions (default: 4)

# ─── Gate configuration ───────────────────────────────────────────────────────

gate:
  min_pass_rate: 0.8          # minimum with-tools pass rate [0–1]
  min_lift: 0.3               # minimum lift over baseline [0–1]

# ─── Custom model pricing ─────────────────────────────────────────────────────

pricing:
  my-custom-model:
    input: 2.0                # USD per million input tokens
    output: 10.0              # USD per million output tokens

# ─── Tasks ────────────────────────────────────────────────────────────────────

tasks:
  - id: task-id               # required, unique slug
    tags: [read, write]       # optional tags for filtering
    prompt: |                 # user message sent to the agent
      Do something specific here.
    assert:
      - type: tool_called
        tool: some_tool
```

---

## `server` section

### Stdio server

Launches a subprocess for the MCP server. The process is **respawned for every trial** — state never leaks between trials.

```yaml
server:
  command: node
  args: [dist/server.js, --port, "3000"]
  cwd: ../                      # relative to the suite file
  env:
    DATABASE_URL: postgres://localhost/test
    LOG_LEVEL: error
  fixture: test-data/           # see below
```

| Field | Required | Description |
|---|---|---|
| `command` | ✅ | Executable name or path |
| `args` | — | Arguments array (default: `[]`) |
| `cwd` | — | Working directory, relative to suite file |
| `env` | — | Extra env vars passed to the subprocess |
| `fixture` | — | Directory to copy into `$TRIAL_DIR` before each session |

**Fixture directory:** When `fixture` is set, ToolGrade copies that directory into a fresh temporary directory before each trial and sets `TRIAL_DIR` in the server's environment. This ensures every trial starts with the same known data.

```yaml
server:
  command: node
  args: [dist/server.js]
  env:
    DATA_DIR: $TRIAL_DIR        # server reads from this path
  fixture: test-fixtures/       # copied into $TRIAL_DIR per trial
```

### HTTP server

Connects to an already-running HTTP server that speaks Streamable HTTP MCP.

```yaml
server:
  url: http://localhost:3000/mcp
  headers:
    Authorization: Bearer test-token-123
    X-Tenant-Id: test-tenant
```

| Field | Required | Description |
|---|---|---|
| `url` | ✅ | Full URL to the MCP endpoint |
| `headers` | — | HTTP headers to include in every request |

> **Note:** With HTTP servers, state is *not* automatically isolated between trials. If your tests are stateful, your server must handle test isolation itself (e.g., via a `reset` tool or per-request tenant isolation).

---

## `agent` section

| Field | Default | Description |
|---|---|---|
| `model` | — | Required. Model identifier (e.g. `claude-sonnet-5`, `gpt-4o`, `qwen3:8b`) |
| `system` | — | Optional system prompt prepended to every conversation |
| `max_turns` | `10` | Maximum agent turns before the trial ends |
| `max_tokens` | `16000` | Maximum tokens per model response |
| `max_tool_result_chars` | `20000` | Tool results are truncated to this length before reaching the model |
| `effort` | — | Extended thinking effort level: `low`, `medium`, `high`, `xhigh`, `max` (Claude only) |

---

## `judge` section

| Field | Default | Description |
|---|---|---|
| `model` | matches `agent.model` | Model used for `type: llm` assertions |

---

## `run` section

| Field | Default | Description |
|---|---|---|
| `trials` | `3` | Number of times each task is run per arm |
| `baseline` | `true` | Whether to run the no-tools arm |
| `concurrency` | `4` | Number of trials to run in parallel |

**Concurrency guidance:**
- Higher concurrency speeds up runs but increases parallel API load
- For local models (Ollama), use `concurrency: 1` or `2`
- For hosted APIs, `4` is usually a safe default; go higher if you have rate limit headroom

---

## `gate` section

Gate checks run after all trials. If any check fails, the CLI exits with code 1.

| Field | Type | Description |
|---|---|---|
| `min_pass_rate` | `0`–`1` | Required with-tools pass rate. E.g. `0.8` = 80% |
| `min_lift` | `0`–`1` | Required lift over baseline. E.g. `0.3` = 30 percentage points |

Both fields are optional. If neither is set, the gate always passes.

---

## `pricing` section

Overrides built-in price lookups for custom or unknown models.

```yaml
pricing:
  my-finetuned-model:
    input: 1.5    # USD per million input tokens
    output: 6.0   # USD per million output tokens
  another-model:
    input: 0.0
    output: 0.0
```

Built-in prices for Claude models are maintained in the CLI. Unknown models produce `n/a` in cost reporting. Use `--local-model` to suppress cost reporting for local/free models.

---

## `tasks` section

Each task represents one evaluation scenario.

```yaml
tasks:
  - id: unique-task-id         # required, used in reports and --filter
    tags: [tag1, tag2]         # optional, used with --filter
    prompt: |                  # required, sent as user message to agent
      Your prompt here.
    assert:                    # list of assertions (see Assertions Reference)
      - type: tool_called
        tool: some_tool
```

| Field | Required | Description |
|---|---|---|
| `id` | ✅ | Unique slug, used in reports, filtering, and baseline matching |
| `prompt` | ✅ | The user message sent to the agent |
| `tags` | — | String array; used with `--filter` |
| `assert` | — | Array of assertions (omit for a task that always passes) |

**Task id stability:** When you upload runs to the dashboard and compare across runs, task ids are matched by name. Renaming a task id breaks the comparison history for that task.

---

## Environment variable substitution

You can reference environment variables in the `server.env` section and `server.url` using `$VAR_NAME` or `${VAR_NAME}` syntax:

```yaml
server:
  command: node
  args: [dist/server.js]
  env:
    DATABASE_URL: $TEST_DATABASE_URL
    API_KEY: ${MY_SERVER_TEST_KEY}
```

The substitution uses the outer process environment (the shell running `toolgrade run`). Undefined variables expand to an empty string.

---

## Multiple suite files

You can maintain multiple suite files for different environments or concerns:

```bash
# Fast smoke test (1 trial, only critical tasks)
toolgrade run toolgrade.yaml --trials 1 --filter critical

# Full evaluation suite for CI
toolgrade run toolgrade.yaml

# Security-focused subset
toolgrade run security-suite.yaml
```

---

## See also

- [Assertions Reference](./assertions.md) — full details on every assertion type
- [CLI Reference](./cli.md) — flags that override suite settings
- [Writing Your First Suite](../guides/writing-your-first-suite.md) — practical advice on task design
