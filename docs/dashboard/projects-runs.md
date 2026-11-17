# Projects & Runs

A deep dive into the run history, run detail, comparison, and model matrix views.

---

## Runs list

**URL:** `/app/[org]/[project]/runs`

The full paginated history of all runs for a project.

**Filters:**
- **Model** — filter to runs that used a specific agent model
- **Branch** — filter to runs from a specific git branch
- **Gate** — filter to only passing or only failing runs

Each row shows: timestamp, suite name, model, branch, commit, pass rate, lift, gate status, cost.

---

## Run detail

**URL:** `/app/[org]/[project]/runs/[run]`

The most detailed view in the platform. Everything about one run.

### Run metadata
At the top: timestamp, suite name, model, provider, branch, commit message, and a **Demo** / **Live** badge indicating whether this was a seeded demo run or a real CLI run.

### KPI tiles
- **Pass rate** — with-tools pass rate and 95% CI
- **Baseline rate** — no-tools pass rate
- **Lift** — with significance flag and 95% CI
- **Cost** — total cost in USD with per-unit breakdown

### Gate checks
A panel showing each gate check and whether it passed. If a gate failed, the failing check is highlighted in red with the actual vs. required value.

---

### Per-task breakdown

A table with one row per task. Each row shows:

| Column | Description |
|---|---|
| **Task** | Task id and tags |
| **Dumbbell** | Visual bar from baseline rate to pass rate |
| **Pass rate** | % of trials that passed, with-tools arm |
| **Baseline** | % of trials that passed, no-tools arm |
| **Lift** | Pass rate minus baseline rate |
| **Tool calls** | Mean tool calls per trial |
| **Status** | ✅ All passed / ⚠️ Partial / ❌ All failed |

The **dumbbell visualization** makes it easy to see which tasks are driving value: a long bar from low baseline to high pass rate indicates strong tool impact on that task. A short bar (or one that starts and ends at the same point) indicates the tools aren't helping for that task.

---

### Trial inspector

Click any task row to open the **trial inspector sheet** — the most useful debugging view in the platform.

For each trial, you see:
- **Tool call trace** — in order: tool name, arguments (formatted JSON), and the tool's response
- **Assertion results** — each assertion with pass/fail and reason (especially useful for `llm` assertions which include the judge's reasoning)
- **Final answer** — the agent's last message
- **Arm** — `with-tools` or `baseline`

**Debugging a low-pass-rate task:**
1. Open the trial inspector for a failing trial
2. Check whether the right tool was called — if not, the prompt may be unclear
3. If the tool was called, check the arguments — wrong arguments suggest a description problem
4. If arguments were right, check the tool's response — the tool may be returning unexpected data
5. If the response looks correct, check the assertions — the assertion may be too strict

---

### Tool surface panel

Shows aggregate data about tool usage across all trials in this run:

- **Called tools** — tools that were called at least once, with total call count and error count
- **Uncalled tools** — tools that were never called in any trial
- **Tool surface fingerprint** — a hash of all tool names, descriptions, and schemas at the time of the run

If a tool was never called in any trial, it may be:
- Not needed for the tasks in this suite
- Poorly described (the agent didn't know when to use it)
- Named ambiguously (the agent used a different tool instead)

The fingerprint is used in the compare view to flag when tools changed between runs.

---

## Comparing runs

**URL:** `/app/[org]/[project]/compare`

Side-by-side statistical comparison of any two runs.

### Selecting runs

Use the **Base** and **Head** dropdowns to select any two runs in the project. The most common use case is comparing the run before a change (base) and after (head).

You can also arrive pre-populated via URL parameters:
```
/compare?base=run_abc123&head=run_def456
```

The CLI's `--baseline` flag links here automatically when it uploads results.

### Reading the comparison

**Overall verdict:**
- **Improved** — at least one task significantly improved, none regressed
- **No significant change** — no statistically significant changes detected
- **Regressed** — at least one task significantly regressed

The verdict uses Bonferroni correction — a statistical method that prevents false alarms when comparing many tasks at once. This means a task needs to regress *substantially* (not just one failed trial) to register as `REGRESSED`.

**Per-task verdicts:**

| Verdict | Meaning |
|---|---|
| `IMPROVED` | Task pass rate increased significantly |
| `no significant change` | No statistically meaningful difference |
| `REGRESSED` | Task pass rate decreased significantly |

**Tool surface diff warning:**

If the tool surface fingerprint changed between runs (tools were added, removed, renamed, or their descriptions changed), a warning banner appears. This doesn't block the comparison but provides important context — a regression after tool changes may be caused by the description change, not a logic bug.

---

## Model matrix

**URL:** `/app/[org]/[project]/model-matrix`

A cross-model comparison table showing every model that has ever run evaluations on this project.

Each row represents one model and shows:
- **Model name** — with provider badge (Anthropic, OpenAI, Ollama, etc.)
- **Runs** — total runs using this model
- **Pass rate** — latest run pass rate / average across all runs
- **Lift** — latest lift
- **Gate** — latest gate status
- **Cost/run** — average cost per run
- **Trend** — sparkline chart of recent pass rates

**Use cases:**
- Compare Anthropic vs. OpenAI models on your specific tools
- Find the cheapest model that still passes your quality gate
- Detect model updates (e.g., a new Claude version) changing behavior

Click any row to see that model's runs filtered in the runs list.

---

## Multiple workspaces

If you need to separate different projects (e.g., different clients, different products), create additional workspaces from the account menu → **New workspace**. Each workspace is a separate tenant with its own projects, members, billing, and API keys.
