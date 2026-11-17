# ToolGrade MCP Server Benchmark (v0)

Does a given MCP server make an agent better at real tasks than the same agent with no tools?
This benchmark answers that for widely used, credential-free reference servers, with the same
engine and statistics ToolGrade uses in CI.

Results: [results/leaderboard.json](results/leaderboard.json) and https://sifisatz.github.io/toolgrade/benchmark/

## What is graded

| Server | Version (pinned) | Tasks | What the checks look at |
|---|---|---|---|
| `@modelcontextprotocol/server-everything` | 2.3.0 | 5 + control | the answer, read from the official reference/test server's deterministic tools |
| `@modelcontextprotocol/server-filesystem` | 2.3.0 | 6 + control | the answer, or files on disk after the run |
| `@modelcontextprotocol/server-memory` | 2.1.1 | 5 + control | the answer, or the knowledge graph after the run |
| `@modelcontextprotocol/server-sequential-thinking` | 2.1.1 | 5 + control | the answer to a multi-step problem |
| `mcp-server-calculator` | 0.2.1 | 4 + control | the exact result of a multi-step expression |
| `excel-mcp-server` | 2.3.2 | 4 + control | the answer, or a workbook's cells after the run |
| `mcp-pandoc` | 0.11.1 | 4 + control | the converted content the tool returns |

Versions are pinned in [package.json](package.json); suites are in [suites/](suites/).

## Method

- **Two arms.** Every task runs with the server's tools and with no tools, 3 trials each.
- **Outcome checks only.** A trial passes when the answer is right or the server's state is right
  afterwards (a file's contents, an entity in the graph) - never because a particular tool was
  called. The no-tool baseline is graded on the same outcomes.
- **Fresh sandbox per trial.** Each trial gets a private copy of the suite's fixture
  (`fixtures/`) as the server's working data, so no trial sees another's changes.
- **A control task** ("What is 17 * 23?", no tool calls allowed) checks that the tools do not
  distract the agent on something it can do alone.
- **Statistics.** Tasks, not trials, are the sample: suite pass rates use a 95% Wilson interval
  at n = tasks and lift uses Newcombe's hybrid score interval. With 6-7 tasks per server the
  intervals are wide on purpose - a "significant" lift here is a strong result.
- **Checks are tested.** [test/benchmark-suites.test.ts](../test/benchmark-suites.test.ts) runs a
  reference solution for every task against the real pinned server (it must pass) and the
  untouched starting state (it must fail), so no check can pass vacuously.

## What failed, and why (v0, qwen3:8b)

Read from the trial trajectories in `results/2026-11-16-qwen3-8b/`:

- **memory / recall-lead - 0/3.** Every trial called `search_nodes` with `observationLimit: 0`,
  which omits each entity's observations. The model found the project lead but never saw
  "Ships in December" and reported that no ship date exists. Optional parameters that silently
  drop data invite small models to suppress exactly what they need.
- **filesystem / top-region - 0/3.** The model invented a filename (`Q3_revenue_report.txt`),
  searched for its own guess and gave up, never listing the directory where `reports/q3.csv` sat.
- **filesystem / append-todo - 1/3.** One trial appended to an invented `notes/todo.md` and
  reported success; another used a made-up `/project/...` path the server refused. The passing
  trial overwrote the whole file before rebuilding it.

- **sequential-thinking - no lift.** All five reasoning problems passed 3/3 with and without the
  tool. The model still called it ~0.7 times per task, and once used it for 17 * 23 (right answer,
  but the control task allows no tool calls). On these problems it added cost, not accuracy.

Read from the trial trajectories in `results/2026-11-17-qwen3-8b/`:

- **everything / no-tool-needed - 1/3 with tools vs 3/3 baseline.** Even on the control task,
  having 16 tools in context sometimes pulled the model into calling one (`get-sum`) instead of
  just answering 17 * 23 - a lift regression caused purely by tool-surface distraction, same
  pattern as `sequential-thinking`.
- **excel / mark-shipped and add-order - 0/3, zero tool calls.** Faced with 46 tools (~13.5k
  schema tokens), the model concluded *"none of the provided functions support direct cell
  modification"* and answered without trying anything - `write_range` was right there in the
  list. A smaller tool surface, or a server that groups/searches tools instead of listing all 46
  flat, would very likely change this.
- **excel / top-customer - 0/3.** Instead of `read_range`, the model reached for
  `create_pivot_table` with an invented `sort_by` argument that does not exist in that tool's
  schema, got a validation error back, and gave up rather than retrying with a simpler tool.
- **pandoc / markdown-to-latex - 0/3 with tools vs 3/3 baseline (-100pp), but this one is a task
  bug, not a finding.** `convert-contents` requires an explicit `output_file` for LaTeX (one of
  `mcp-pandoc`'s "advanced formats"), which this task's prompt never asked for. Two of three
  trials correctly told the user exactly that and stopped; the third supplied its own output path,
  got a real conversion back, and still failed only because it wrote `\section*{Title}` where the
  check expected `\section{Title}`. The model handled this task more carefully than the suite did -
  left in deliberately as a reminder that an unexplained regression is worth reading the
  trajectory for before it goes in a findings list.
- **pandoc, more generally.** A content-conversion tool is weak ground for lift when the source
  content is already sitting in the prompt: on the other three tasks the baseline could often
  paraphrase a simple markdown/HTML transform itself well enough to pass, even without pandoc.

## Limitations - read before quoting a number

- A score belongs to **server + model + task set**, never to the server alone. v0 uses one
  open-weights model (`qwen3:8b`, run locally via Ollama); a stronger model would score higher,
  and tool descriptions matter more for small models.
- Tasks are written by the ToolGrade authors; 5-6 tasks per server cannot cover a server's
  whole surface. Suggestions and new tasks are welcome as pull requests.
- `sequential-thinking` has no state to check, so its tasks are reasoning problems; a lift near
  zero means the scaffold did not help on these problems with this model, not that it never helps.
- Servers that need accounts or API keys (GitHub, Slack, ...) are not in v0.
- The runner container's network is internal-only (no internet), by design - see the Reproduce
  section. Servers that need to reach a real external API (a weather or search API, Wikipedia, ...)
  are not in v0 either, until that network policy gets a deliberate, separately-reviewed exception.
- `mcp-server-calculator`'s suite is written and its checks are validated against the real server
  ([test/benchmark-suites.test.ts](../test/benchmark-suites.test.ts) passes), but it has no
  published run yet: `qwen3:8b`'s reasoning mode spiralled into several-thousand-token chains of
  thought on these arithmetic tasks, which combined with this host's CPU throttling to blow past
  even an extended request timeout. Its `max_tokens` is now capped to fail a runaway trial cleanly
  instead of timing out the whole run; it just has not been re-run since.

## Reproduce (containerised - recommended)

Nothing is installed on the host except Podman. The model and every MCP server under test run in
containers on a dedicated Podman machine:

| Container | What | Isolation |
|---|---|---|
| `tg-ollama` | Ollama 0.40.16 serving the model from the `tg-ollama` volume | internal network only |
| `toolgrade-runner` | the CLI and the pinned MCP servers; servers are spawned inside it | internal network (reaches only `tg-ollama`, no internet), non-root, read-only root filesystem, all capabilities dropped; writes only `benchmark/results` and a `/tmp` tmpfs for trial sandboxes |

```bash
benchmark/container/tg.sh up                     # dedicated 'toolgrade' Podman machine + Ollama
benchmark/container/tg.sh pull qwen3:8b          # once: downloads the model into the volume
benchmark/container/tg.sh build                  # runner image
benchmark/container/tg.sh run qwen3:8b           # all suites, or name suites after the model
npx tsx benchmark/summarize.mts                  # rebuilds the leaderboard
benchmark/container/tg.sh down                   # stop the containers and the machine
```

Podman on macOS runs one machine at a time, so `up` refuses to start while another machine is
running. If a machine then fails to start again with a `gvproxy` socket error, or its published
ports report "address already in use", a `gvproxy` from its previous session is still alive
(`ps -axo pid,etime,command | grep gvproxy`); stop that exact PID and start the machine again. On a Mac the model runs on CPU inside the VM (the official arm64 Ollama image has no
Vulkan backend); `qwen3:8b` generates ~28 tokens/s on 8 cores.

Without containers: `ollama serve`, then `benchmark/run.sh openai qwen3:8b` on the host. With a
hosted model: `benchmark/run.sh anthropic claude-sonnet-5` (needs `ANTHROPIC_API_KEY`).
