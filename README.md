# ToolGrade

[![CI](https://github.com/sifisatz/toolgrade/actions/workflows/ci.yml/badge.svg)](https://github.com/sifisatz/toolgrade/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/toolgrade.svg)](https://www.npmjs.com/package/toolgrade)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)

[Website](https://sifisatz.github.io/toolgrade/) · [Public benchmark leaderboard](https://sifisatz.github.io/toolgrade/benchmark/) · [Platform (web/)](web/README.md) · [Methodology](#statistics-notes)

**Eval-first quality gates for MCP servers.** ToolGrade answers one question with evidence:
*does your tool surface make an agent better at real tasks than the same agent with no tools?*

Every task runs in two arms - **with your tools** and **with no tools** - over several trials.
You get pass rates with confidence intervals, the **lift** over the baseline, cost per trial,
and a CI gate that fails when quality drops. A [public benchmark](benchmark/README.md) runs the
same engine against widely used reference MCP servers, with every finding traced back to a real
trial trajectory - not just a number.

Output of `pnpm demo` (real pipeline and real example server; a scripted stand-in replaces the
model, so it runs with no API key):

```
ToolGrade - notes-server
task                 with tools  baseline    lift    calls
find-owner           100% (3/3)  0% (0/3)    +100pp  1.0
incident-root-cause  100% (3/3)  0% (0/3)    +100pp  2.0
create-note          100% (3/3)  0% (0/3)    +100pp  1.0
delete-note          100% (3/3)  0% (0/3)    +100pp  2.0
no-tool-needed       100% (3/3)  100% (3/3)  +0pp    0.0
summarize-plan       100% (3/3)  0% (0/3)    +100pp  2.0

Pass rate (tools)  100% over 6 tasks (18/18 trials)  95% CI 61%-100%
Pass rate (none)   17% over 6 tasks (3/18 trials)  95% CI 3%-56%  outcome assertions only
Lift               +83pp  95% CI +28pp..+97pp  significant
Gate passed

ToolGrade - notes-server (vague tools)      <- same agent, vague descriptions, worse search
Pass rate (tools)  33% over 6 tasks (6/18 trials)  95% CI 10%-70%
Lift               +17pp  95% CI -30pp..+56pp  not significant - add tasks
FAIL min_pass_rate: pass rate 33% vs required 80%
Gate failed

Comparison: regressed
overall over 6 matched tasks 100% -> 33%  -67pp  95% CI -90pp..-13pp
per-task verdicts are Bonferroni-corrected
  find-owner                   100% ->   0%  worse
  create-note                  100% -> 100%  ~
  delete-note                  100% ->   0%  worse
```

## Contents

[Why](#why) · [Quick start](#quick-start) · [Local model](#run-with-a-local-model-no-api-key) ·
[Platform](#platform-dashboard--ingestion-api) · [Commands](#commands) ·
[Suite file](#suite-file) · [Library use](#library-use) · [CI](#ci) ·
[Statistics](#statistics-notes) · [Roadmap](#roadmap) ·
[Public benchmark](benchmark/README.md)

## Why

- **Baseline or it did not happen.** A tool that does not beat "no tools" is a cost (schema
  tokens, latency, distraction), not a feature. The headline metric is the lift. The baseline is
  graded on *outcome* assertions only, so lift means "better results", not "used tools".
- **Grade outcomes, not claims.** `state` assertions query your server after the run, so an
  agent that *says* it deleted the note but did not, fails.
- **Variance is reported, not hidden.** Wilson intervals on pass rates, a Newcombe interval on
  lift, and run-to-run comparison that says "inconclusive - add trials" instead of guessing.
- **Fresh server per trial.** stdio servers are re-spawned for every trial, so state never
  leaks between trials or arms. HTTP servers get a fresh connection but ToolGrade cannot reset
  their data - point them at a disposable test environment.
- **Your API key stays yours.** The server under test gets a minimal environment plus what the
  suite declares - never the model credentials.

## Quick start

```bash
pnpm install && pnpm build
pnpm demo                                             # full pipeline offline, no API key
node dist/cli.js inspect examples/notes-suite.yaml   # list + lint tools, no API key needed
export ANTHROPIC_API_KEY=...                          # or `ant auth login`
node dist/cli.js run examples/notes-suite.yaml --trials 3 --markdown summary.md
```

Demonstrate a regression: set `NOTES_SERVER_VAGUE: "1"` in the suite (same tools, vague
descriptions and an exact-title-only search), run again, then:

```bash
node dist/cli.js compare .toolgrade/runs/<good>.json .toolgrade/runs/latest.json
```

## Run with a local model (no API key)

Any OpenAI-compatible endpoint works through `--provider openai`; Ollama is the free, local one.

```bash
brew install ollama && ollama serve        # or open the Ollama app
ollama pull qwen3:8b                       # any model with tool calling
node dist/cli.js run examples/notes-suite.yaml --provider openai --model qwen3:8b --concurrency 2
```

`--model` overrides both agent and judge; pass `--judge-model` to judge with a different one.
Localhost endpoints are priced at $0. Hosted endpoints work the same way, e.g.
`--base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY`. Small local models make
more tool-use mistakes than frontier models - expect lower pass rates, which is exactly what
ToolGrade is there to measure - and a small judge is less reliable on `llm` assertions.

## Platform (dashboard + ingestion API)

`web/` is the hosted side: run history with trend charts, per-task drill-down into every trial's
tool calls (including which tool got called instead of the one a task expected), run-vs-run
compare (pass-rate significance plus cost/latency regression and infra-failure counts), a model
matrix, a per-project tool graph (coverage, task x tool co-occurrence, minimal-tool-set savings),
thumbs-up/down run annotations, a public benchmark leaderboard, and per-project API keys for CI
uploads (`toolgrade run ... --upload <url>` or `toolgrade upload <report.json>`). It runs locally
with no infrastructure - see [web/README.md](web/README.md), the stack decision in
[docs/ADR-001-web-stack.md](docs/ADR-001-web-stack.md), and the security/privacy posture in
[docs/SECURITY.md](docs/SECURITY.md).

## Commands

| Command | What it does | Exit code |
|---|---|---|
| `run <suite>` | tasks x {tools, baseline} x trials, then the gate. Writes `.toolgrade/runs/<ts>.json` and `latest.json`. `--compare <report>`/`--baseline <url>` fails on a significant pass-rate regression; `--gate-cost-regression <pct>` / `--gate-latency-regression <pct>` additionally fail it on a cost or latency regression past that threshold (needs `--compare`/`--baseline`). `--markdown <file>` for PR comments, `--otel-export <file>` to also write the run as OTel GenAI spans (OTLP/JSON) for Jaeger/Langfuse/Phoenix. | 0 pass, 1 gate failed / regressed, 2 error |
| `init [-- cmd args...]` / `init --url <url>` | Connects to your server and writes `toolgrade.yaml`: a real draft task per tool (prompt + `tool_called` assertion, derived from the tool's own schema, with a destructive-looking tool also getting a placeholder `output_contains` check), plus a no-tool control task. A draft that would trip the suite-validity checks below falls back to a `TODO:` placeholder instead - `run` refuses a suite that still has one. | 2 if the file exists (use `--force`) |
| `import --from <client>` | Scaffolds a suite from an MCP server already configured in an AI client - `claude-desktop`, `claude-code`, `cursor` or `vscode`. `--detect` just reports which client configs exist on this machine. Reuses the same draft-generation as `init`. | 2 if the file exists (use `--force`) |
| `inspect <suite>` | Connects, lists tools, and runs every static check with no model calls: name/description/parameter-doc lint, a 0-100 description quality score, MCP spec compliance (annotations, documented params), a safety pass (destructive actions missing `destructiveHint`, prompt-injection-shaped text), and suite-validity findings (near-duplicate tasks, assertions that rely solely on an unfalsifiable LLM judge). | 1 on lint errors |
| `upload <report> --url <origin>` | Uploads an existing run report to a ToolGrade platform (`TOOLGRADE_API_KEY`). | 2 on failure |
| `compare <before> <after>` | Statistical comparison of two run reports: pass-rate significance, plus cost and latency deltas per task. | 1 if regressed |

## Suite file

Start from your own server with `npx toolgrade init -o evals/suite.yaml -- node dist/server.js`.

```yaml
name: my-server
server:                      # stdio (fresh process per trial) ...
  command: node
  args: [dist/server.js]
  cwd: ..                    # relative to this file
  env: { DATABASE_URL: "postgres://localhost/test" }
# server: { url: https://localhost:3000/mcp, headers: { Authorization: "Bearer test" } }

agent:  { model: claude-opus-5, max_turns: 10, effort: medium, max_tool_result_chars: 20000, system: "optional" }
judge:  { model: claude-sonnet-5 }
run:    { trials: 3, baseline: true, concurrency: 4 }
gate:   { min_pass_rate: 0.8, min_lift: 0.3 }
pricing: { my-custom-model: { input: 2, output: 10 } }   # USD per MTok, overrides defaults

tasks:
  - id: create-note
    tags: [write]
    prompt: Create a note titled 'Offsite agenda' ...
    assert:                                   # a trial passes when every assertion passes
      - { type: tool_called, name: create_note, max_times: 1, args_contains: { title: Offsite } }
      - { type: state, tool: search_notes, args: { query: Offsite agenda }, contains: Offsite agenda }
    variants:                                 # optional: A/B test tool descriptions on this task
      - id: terse                             # reported next to the base arm, never gates the run
        tool_overrides:
          create_note: { description: "Create a note." }
      - id: hide-list                         # description: null suppresses a tool for this arm
        tool_overrides:
          list_tags: { description: null }
```

| Assertion | Passes when |
|---|---|
| `output_contains` | final answer contains `value` (string or list; `mode: all\|any`, `case_sensitive`, `negate` - see below) |
| `output_regex` | final answer matches `pattern` (`flags`, default `i`; `negate` - see below) |
| `tool_called` | tool called `min_times..max_times`, optionally with `args_contains` (substring for strings, deep-equal otherwise) |
| `tool_not_called` | tool never called |
| `max_tool_calls` | total tool calls <= `value` (use `0` for "tools must not distract") |
| `state` | after the run, calling `tool` with `args` returns text containing `contains` and none of `not_contains` |
| `llm` | the judge model, given task, tool trace and answer, says the `rubric` is met (structured JSON verdict; unparseable = fail) |

`output_*`, `state` and `llm` are **outcome** assertions; `tool_called`, `tool_not_called` and
`max_tool_calls` are **process** assertions. The baseline arm is graded on outcomes only (process
assertions are recorded as skipped); a task with no outcome assertions has no baseline.

`negate: true` on `output_contains`/`output_regex` flips the check to "passes only when absent" -
for proving a tool never echoes back something it shouldn't (a secret, another user's data), not
just that it mentions what it should. Combined with `tool_not_called` this is the basis for
writing MCP security/permission tasks (unauthorized tool usage, excessive permissions, sensitive
output exposure, resistance to instructions embedded in tool output) as ordinary pass/fail checks -
see [examples/security-suite.yaml](examples/security-suite.yaml). There is no separate "security
score": each task is inspectable evidence (which assertion, what it expected, what actually
happened), the same as any other task.

A trial that does not end normally - `max_turns`, `max_tokens`, `refusal`, context exceeded -
fails regardless of assertions, and only the last turn's text counts as the answer. An error is
classified `infra` (a 429, a 400 carrying a rate-limit/budget/content-filter/quota message, or a
connection-level failure) or `fail` (anything else, including a request that grew too long from
tool output). `infra` trials are excluded from pass rates and from the `no_errors` gate check
entirely - reported separately as "N trials excluded as infra failures" - so a transient provider
rejection can't fail the gate the way a real bug would; `fail` trials still count against both.
Either way their spend is kept and the total is marked as a lower bound. Configuration-level API
errors (bad key, unknown model, malformed first request) abort the run instead of producing a
meaningless score. Tool results are capped at `max_tool_result_chars` before they reach the model,
and binary content (images, audio, blob resources) is replaced by a placeholder.

The LLM judge sees tool calls and the answer inside randomly named tags it is told to treat as
untrusted data, so an agent or server cannot close the block and rewrite the rubric.

Write `state` probes that work across every server variant you compare - a probe that depends on
the behaviour under test can pass for the wrong reason.

## Library use

```ts
import { loadSuite, runSuite, AnthropicProvider, ScriptedProvider } from "toolgrade";
const report = await runSuite(await loadSuite("suite.yaml"), { provider: new AnthropicProvider() });
```

`ScriptedProvider` drives the whole pipeline deterministically - that is how this repo's
end-to-end tests run against the real example server with no API key.

## CI

A full example is at [examples/github-workflow.yml](examples/github-workflow.yml); the action's
inputs are defined in [action.yml](action.yml). Both the `toolgrade` CLI (`npx toolgrade@latest
run ...`) and the `toolgrade/toolgrade@v0` action reference in the example are live.

The action is a composite action (`action.yml` + [action/entrypoint.sh](action/entrypoint.sh)) that
installs and runs the published CLI with `npx` - not a Docker action (no image to build, push or
keep warm) and not a bundled JS action (no separate build/release process to keep in sync with the
CLI's own). The entrypoint script is factored out of `action.yml` specifically so it has its own
integration test ([test/action-entrypoint.test.ts](test/action-entrypoint.test.ts)) that exercises
every input's argument mapping and the exit-code/step-summary handling against a fake CLI, without
needing the npm registry, a real MCP server, or a GitHub Actions runner.

**Quick start**

```yaml
- uses: toolgrade/toolgrade@v0
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  with:
    suite: evals/suite.yaml
```

A failed `gate` (see [Suite file](#suite-file)) fails this step, and so the job and the PR check.

**Model credentials.** The action never sees your key directly - set it as an `env:` on the step
itself (as above), from a repository or organization secret. For `--provider anthropic` (the
default) that is `ANTHROPIC_API_KEY`; for `--provider openai` (any OpenAI-compatible endpoint -
OpenAI, Gemini, Groq, a self-hosted vLLM, or a local Ollama with no key at all) set `base-url` and
`api-key-env` inputs, then export that same-named env var on the step. Self-hosted runners work
the same way - nothing in the action depends on GitHub-hosted infrastructure.

**Baseline comparison.** Two ways to get one, and you only need one of them:

- *Hosted (simplest).* Set `upload-url` and an API key (see below), then set `baseline` to the
  same platform origin. Each run compares against the most recent previously-uploaded run for the
  same suite - matched to the PR's base branch automatically in GitHub Actions (`GITHUB_BASE_REF`),
  or set `baseline-branch` explicitly. No build artifacts to manage.
- *Artifact-based (no hosted project needed).* Download the previous run's report (e.g. from a
  build artifact uploaded on the default branch, as in the example workflow) and pass its path as
  the `compare` input.

Either way, a statistically significant regression fails the job; with no prior report yet (first
run, nothing uploaded, or nothing in the artifact), the comparison is skipped rather than treated
as a regression. `compare` and `baseline` are mutually exclusive - use one or the other.

**Uploading to a hosted ToolGrade project.** Set `upload-url` to your platform origin (e.g.
`https://app.toolgrade.dev`) and either set `TOOLGRADE_API_KEY` as an env var on the step or pass
it as the `toolgrade-api-key` input, from a project API key (Settings -> API keys in the
dashboard). This is also what `baseline` above reads from, and separately gives you run history
and comparisons in the dashboard.

**Private or self-hosted MCP servers.** The action makes no assumptions about your server beyond
what the suite's `server:` block says - a stdio command the runner can execute, or an HTTP(S) URL
it can reach (add `headers:` in the suite for auth). On a self-hosted runner with network access
to an internal server, no extra configuration is needed.

**Troubleshooting.** `toolgrade inspect <suite>` (no model calls) is the fastest way to check that
CI can reach your server and see the expected tools before spending any model budget on `run`.
`--filter <idOrTag>` scopes a run to one task while debugging a suite in CI.

## Statistics notes

Trials of the same task are strongly correlated, so suite-level numbers treat **each task as one
observation**: the pass rate is the mean of per-task rates, with a 95% Wilson interval at
n = tasks, and lift is the Newcombe hybrid score interval over the tasks graded in both arms.
This is deliberately conservative: more trials make each task's rate more precise, but only
more tasks tighten the suite-level interval. Per-task rates use trials as the sample. `compare`
uses only tasks present in both runs and Bonferroni-corrects its per-task verdicts, so a large
suite does not produce false regressions by chance. Cost uses list prices from
[src/pricing.ts](src/pricing.ts); unknown models are reported as `n/a` rather than guessed.

## Roadmap

See [docs/PLAN.md](docs/PLAN.md): hosted run history and model-drift alerts, shared task
libraries, trace ingestion that turns real agent sessions into tasks, more providers.
