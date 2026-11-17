# ToolGrade - research notes, product plan, PoC scope

## 1. The problem

Every developer platform now ships an MCP server, agent skills, or an in-product assistant.
Almost none of them can answer the only question that matters:

> Do my tools make an agent *better* at real tasks than the same agent with no tools?

Today teams answer it by vibes: try a few prompts in a chat client, ship, hope. When the
underlying model changes, or someone rewrites a tool description, nobody knows whether quality
moved. Companies that take it seriously are hiring dedicated engineers to build an internal
"eval-first" harness by hand. That repeated, bespoke build is the market.

## 2. What exists and why it is not enough

| Category | Examples | Gap for MCP-tool authors |
|---|---|---|
| General LLM eval / tracing platforms | Braintrust, LangSmith, Langfuse, promptfoo | Prompt-and-output centric. You can wire an MCP server in, but there is no first-class notion of a *tool surface under test*, a no-tool baseline arm, or end-state verification against the server. |
| MCP inspectors / debuggers | MCP Inspector | Manual, single-call, no task success, no statistics. |
| Public agent benchmarks | tool-use leaderboards | Measure models, not *your* tools. |

The durable gap: **tool authors need a CI gate for their tool surface**, the way they have unit
tests for their code.

## 3. Principles (what separates a durable pattern from hype)

1. **Baseline or it did not happen.** Every task runs in two arms - with tools, and with no
   tools. The product headline is the *lift*, not the raw pass rate. A tool that does not beat
   the baseline is a cost (tokens, latency, confusion), not a feature. The baseline is graded on
   outcome assertions only - grading it on "did it call the tool" would make lift meaningless.
2. **Grade outcomes, not claims.** Agents say "done" when they are not. Assertions can query
   the server's real state after the run (`state` assertion), not just read the transcript.
3. **Variance is a first-class output.** Agents are stochastic. Every task runs N trials;
   pass rates come with 95% Wilson intervals, lift with a Newcombe interval, and the
   regression gate distinguishes "significantly worse" from "inconclusive". Trials of one task
   are correlated, so suite-level intervals use tasks, not trials, as the sample size.
4. **Deterministic checks first, LLM judge last.** Cheap, exact assertions (tool called,
   arguments, output contains, end state) carry the weight; the LLM judge is reserved for
   open-ended quality and is itself tracked for cost.
5. **Cost is a metric, not an afterthought.** Tokens and dollars per trial, per arm, plus the
   tool-schema size the tools add to every request.
6. **Isolation.** Each stdio trial gets a fresh server process, so state from one trial can
   never leak into the next.

## 4. Product shape (SaaS)

- **Open-source CLI + GitHub Action (the wedge).** `npx toolgrade run suite.yaml` in CI, a
  Markdown report as a PR comment, non-zero exit on gate failure. Free, local, BYO API key.
- **Hosted tier (the business).** Run history and trend lines per tool, model-drift alerts
  ("your pass rate on the new model dropped 12 points"), a shared task library per product
  surface, managed parallel runners, team review of judge disagreements, and production
  telemetry ingestion so real agent sessions turn into new eval tasks.
- **Pricing.** Free CLI. Team plan per seat + metered trial-minutes. Enterprise: SSO, VPC
  runners, audit.

## 5. PoC scope (this repository)

In:
- Suite file (YAML, zod-validated): server, agent, judge, run, gate, tasks with assertions.
- MCP connection over stdio (fresh process per trial) and Streamable HTTP.
- Agent loop with full trajectory capture (tool calls, args, results, errors, tokens, latency).
- Two arms (tools / baseline) x N trials, bounded concurrency.
- Assertions: `output_contains`, `output_regex`, `tool_called` (count + argument match),
  `tool_not_called`, `max_tool_calls`, `state` (post-run tool query), `llm` (rubric judge).
- Statistics: Wilson CI, Newcombe CI for lift, two-run regression comparison.
- Cost accounting with an overridable price table.
- `inspect` command: lists tools and lints their descriptions/schemas without any API key.
- Reports: terminal, JSON run file, Markdown for PR comments; gate exit codes.
- Provider abstraction: Anthropic for real runs, a scripted provider for deterministic tests.
- Example MCP server (notes) with a deliberately degraded "vague" variant to demo the lift.

Out (v2): billing, trace ingestion, multi-turn simulated users. (Since delivered on top of the
PoC: hosted dashboard with sign-in and org isolation, OpenAI-compatible and local-model
providers, `init` scaffolding, a public marketing site, and a live demo deployment.)

## 7. Honest assessment (2026-11-16)

The PoC is a credible demo, not yet a business. The core loop - run with and without tools,
check outcomes, report intervals - is easy to replicate; any eval platform could add it in a
sprint. What is defensible is the angle (a no-tool baseline, state-checked outcomes, honest
statistics) and owning the "CI for MCP servers" category before anyone else does. Money comes
from the parts customers cannot easily build themselves.

## 8. Roadmap

Ordered by evidence per unit of effort. Each phase has an exit criterion; do not start the next
phase's build work until the previous one has produced its evidence. Status reflects what is
actually in the repo as of 2026-11-17.

| # | Phase | What | Exit criterion | Status |
|---|---|---|---|---|
| 1 | **Public benchmark** | Grade widely used, credential-free MCP servers with real, state-checked tasks; pinned versions; publish a leaderboard and the method. | Leaderboard live; results reproducible from the repo with one command; method page published. | **Shipped.** `benchmark/` runs filesystem, memory, and sequential-thinking suites with per-trial fixture isolation (`benchmark/run.sh`, `benchmark/suites/`); `benchmark/results/leaderboard.json` and the marketing site's `/benchmark` page publish results and method. Still one model column (`qwen3:8b`) - hosted-model columns are the remaining gap, see phase 4. |
| 2 | **Customer discovery** (in parallel with 1) | Talk to 10-15 teams shipping MCP servers; use the benchmark as the conversation opener; sign 3 design partners. | 3 partners running ToolGrade weekly; a ranked list of their pains. | Not tracked in this repo - a business-development effort, not a code artifact. |
| 3 | **Auto-generated tasks** | Generate candidate tasks and outcome checks from tool schemas, docs and (later) real usage logs; a human approves; generated tasks are validated against the live server before use. | Partners get a useful first suite in under 15 minutes without writing tasks by hand. | **Partially shipped.** `toolgrade init` (`src/init.ts`) generates one starter task per discovered tool plus a no-tool control task, by introspecting the live server's tool schemas. Prompts and rubrics are left as `TODO:` placeholders the human must fill in (`run` refuses suites that still contain them) - there is no generation from docs or usage logs yet, and no auto-validation loop beyond the human editing pass. |
| 4 | **Model matrix and drift alerts** | Run the same suite across Claude, GPT, Gemini and open models; re-run on vendor model releases; alert on significant drops. | First alert that a partner acts on. | **Half shipped.** The hosted app has a model matrix (`web/src/app/app/[org]/[project]/model-matrix/`) comparing every model a project has run against, with trend sparklines and lift per model - and the CLI already supports Anthropic, OpenAI-compatible, and local-model providers (`src/providers/`). Drift *alerting* (re-run on vendor releases, notify on a significant drop) is not built; the only scheduled job today is retention cleanup (`web/src/app/api/cron/retention-cleanup/`). |
| 5 | **Stateful sandboxes** | Per-trial seeded environments beyond files: databases, mock accounts, recorded APIs. | A partner's real server graded with state checks, no production data touched. | Not started. Isolation today is still per-trial fixture directories (`${TRIAL_DIR}`), not databases or mock external services. |
| 6 | **Tool-description optimisation** | Automatically test description and schema variants; report the wording with the best significant lift. | One measured, shipped description improvement at a partner. | Not started. `src/lint.ts` statically lints existing descriptions/schemas (part of the original PoC scope's `inspect` command) but does not generate or A/B-test variants. |
| 7 | **Monetisation** | Pricing tested with partners (likely per tool surface with run-minutes, plus enterprise); billing only once someone asks to pay. | First paid contract. | **Infra shipped.** Stripe Checkout, webhook-driven subscription sync, and plan gating are live (`web/src/app/api/stripe/webhook/`, `web/src/lib/billing.ts`, `web/src/lib/stripe.ts`), and the marketing site has a live pricing section. The exit criterion itself - a first paid contract - is a business outcome this repo can't confirm either way. |

Risks to watch: a model vendor or eval platform ships this as a feature (mitigation: speed, the
benchmark as category ownership, depth on sandboxes); MCP spec churn; model spend per run (who
pays, and how to keep runs cheap - local models and caching help); thin moat until phases 5-6 land.

### Phase 1 detail: the public benchmark

- **Servers:** credential-free reference servers anyone can run (no accounts touched, fully
  reproducible). Versions pinned in each suite.
- **Tasks:** realistic requests with outcome checks against the server's actual state after the
  run (files on disk, entities in a knowledge graph), plus at least one no-tool control task.
- **Isolation:** each trial gets a fresh copy of the suite's fixture directory (`${TRIAL_DIR}`).
- **Models:** start with an open-weights model on a laptop (free, reproducible); add hosted
  models as columns when keys are available. Always label the model next to the score. Shipped
  so far: one open-weights column (`qwen3:8b`); hosted-model columns are still open.
- **Publication:** results page on the marketing site, raw run reports in the repo, method and
  limitations stated next to the numbers. A score is about server + model + task set together,
  never the server alone.

## 6. Stack decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 20+ | The MCP SDK and most MCP servers are TS; the audience lives in npm. |
| Packaging | ESM, plain `tsc` build, `bin` entry | Fewest moving parts; `npx toolgrade` works. |
| Validation | zod | Readable errors on bad suite files; already an MCP SDK peer. |
| CLI | commander | Small, typed, standard. |
| Tests | vitest | Fast; the end-to-end test drives a real MCP server over stdio. |
| Model client | `@anthropic-ai/sdk`, manual loop | We need the transport-agnostic loop and full trajectory capture. |
| Storage | JSON files in `.toolgrade/runs/` | Diffable, CI-artifact friendly; hosted tier replaces this. |
