# Writing Your First Suite

A ToolGrade suite is a YAML file that describes your MCP server, the agent that will run it, and a list of tasks to evaluate. This guide walks you through writing a suite that actually catches regressions.

---

## Anatomy of a task

```yaml
tasks:
  - id: delete-note           # unique identifier, used in reports and filtering
    tags: [write, destructive] # optional tags for grouping/filtering
    prompt: |
      I have a note titled "Draft - DO NOT PUBLISH". Please delete it.
    assert:
      - type: tool_called
        tool: delete_note
      - type: state
        tool: list_notes
        args: {}
        output_contains_not: ["Draft - DO NOT PUBLISH"]
```

Every task has:
- **`id`** — a unique slug used in reports, filtering, and baseline comparisons
- **`prompt`** — what the agent is asked to do (written as a user message)
- **`assert`** — a list of assertions that must all pass for the task to pass

---

## The two types of assertions

### Process assertions — did the agent behave correctly?

These check *how* the agent worked: which tools it called, how many times, with what arguments.

```yaml
assert:
  - type: tool_called
    tool: create_note           # tool must be called at least once

  - type: tool_called
    tool: search_notes
    min_times: 1
    max_times: 2                # called between 1 and 2 times

  - type: tool_called
    tool: update_note
    args_contains:              # call must include these argument values
      title: "Shopping list"

  - type: tool_not_called
    tool: delete_note           # this tool must NOT be called

  - type: max_tool_calls
    value: 5                    # total tool calls must not exceed 5
```

Process assertions only run in the **with-tools arm**. They're automatically skipped for the baseline.

### Outcome assertions — did the agent get it right?

These check the final answer or the actual state of your server after the agent finishes.

```yaml
assert:
  - type: output_contains
    value: "successfully created"   # final answer must contain this string

  - type: output_regex
    pattern: "\\d+ notes? found"    # final answer must match this regex

  - type: state
    tool: get_note              # call this tool after the agent finishes
    args: { title: "Shopping list" }
    output_contains: ["milk", "eggs"] # tool's response must contain these

  - type: llm
    rubric: |                   # LLM judge evaluates the answer
      The agent should have confirmed that the note was created and
      mentioned its title. It should not have made up content.
```

Outcome assertions run in **both arms** — they're what generate the lift metric.

---

## Why `state` assertions matter

An agent can lie. It can say "I created the note" without actually calling the tool, or call the tool with wrong arguments and still produce a confident-sounding answer.

The `state` assertion verifies the actual server state after the agent finishes:

```yaml
- type: state
  tool: get_note
  args: { title: "Meeting recap" }
  output_contains: ["Q4 goals", "action items"]
```

This calls `get_note` with `{title: "Meeting recap"}` and checks that the response contains "Q4 goals" and "action items". If the agent didn't actually create the note — or created it with wrong content — this assertion fails.

**Treat `state` assertions as your ground truth.** `output_contains` checks the agent's answer; `state` checks reality.

---

## Writing good prompts

**Be specific about inputs.** Vague prompts produce vague evaluations.

```yaml
# Weak — depends on current server state
prompt: "Find my latest note and summarize it"

# Strong — specifies exact data, deterministic evaluation
prompt: "Find the note titled 'Weekly review - 2026-01-13' and give me a one-sentence summary"
```

**Be specific about the expected outcome.** Tell the agent what success looks like.

```yaml
# Weak — no clear definition of "done"
prompt: "Clean up my notes"

# Strong — clear success criteria
prompt: "Delete all notes with the tag 'archive'. Confirm how many you deleted."
```

**Use fixtures for predictable server state.** If your server reads from a file or database, use the `fixture` option to start each trial with known data:

```yaml
server:
  command: node
  args: [dist/server.js]
  fixture: test-data/   # copied into a fresh TRIAL_DIR per session
  env:
    DATA_DIR: $TRIAL_DIR
```

---

## The control task (no-tool baseline)

Always include at least one task that the model can answer without tools. This calibrates the baseline and verifies the statistical comparison is meaningful.

```yaml
- id: control-factual
  prompt: "What is the capital of France?"
  assert:
    - type: output_contains
      value: "Paris"
```

A healthy baseline pass rate on control tasks (close to 100%) confirms your agent and judge are working correctly.

---

## Structuring a suite

A well-structured suite covers:

| Category | What to test | Example |
|---|---|---|
| **Happy path** | Core use cases working end-to-end | Create, read, update, delete |
| **Edge cases** | Boundary conditions | Empty inputs, special characters, very long content |
| **Error handling** | Bad inputs the agent might send | Non-existent IDs, type mismatches |
| **Multi-step** | Chained tool calls | Search then update, create then delete |
| **Restraint** | Model doesn't call tools unnecessarily | Factual questions with `tool_not_called` |
| **Control** | Tasks model can answer alone | Simple factual questions |

---

## Running a subset

Use `--filter` to run only some tasks while developing:

```bash
# Run tasks with the tag "write"
npx toolgrade run toolgrade.yaml --filter write

# Run one specific task by ID
npx toolgrade run toolgrade.yaml --filter delete-note
```

---

## Tuning trial count

More trials = more statistical confidence but higher cost and time.

| Trials | Use case |
|---|---|
| 1 | Quick smoke test during development |
| 3 | Default — good balance for most tasks |
| 5–10 | High-stakes tasks where false pass/fail is costly |

The confidence interval in results widens when you use fewer trials. Increasing trials narrows it.

---

## Full example suite

```yaml
name: notes-server
version: "1"

server:
  command: node
  args: [dist/server.js]
  cwd: ..
  env:
    DATABASE_URL: postgres://localhost/test
  fixture: test-fixtures/

agent:
  model: claude-sonnet-5
  max_turns: 10
  max_tokens: 16000

judge:
  model: claude-sonnet-5

run:
  trials: 3
  concurrency: 4

gate:
  min_pass_rate: 0.8
  min_lift: 0.3

tasks:
  - id: create-note
    tags: [write]
    prompt: "Create a note with the title 'Team standup' and body 'Discussed deployment blockers'"
    assert:
      - type: tool_called
        tool: create_note
      - type: state
        tool: get_note
        args: { title: "Team standup" }
        output_contains: ["deployment blockers"]

  - id: list-notes-tagged
    tags: [read]
    prompt: "List all notes tagged 'urgent'. Just give me the titles."
    assert:
      - type: tool_called
        tool: list_notes
      - type: llm
        rubric: |
          The agent should have listed note titles. It should not have
          included note body content. It should not make up titles.

  - id: delete-note
    tags: [write, destructive]
    prompt: "Delete the note titled 'Draft - OLD'. Confirm it's gone."
    assert:
      - type: tool_called
        tool: delete_note
      - type: state
        tool: list_notes
        args: {}
        output_contains_not: ["Draft - OLD"]

  - id: restraint-factual
    tags: [control]
    prompt: "What year was the Python programming language first released?"
    assert:
      - type: tool_not_called
        tool: search_notes
      - type: output_contains
        value: "1991"
```

---

## Next steps

- [Assertions Reference](../reference/assertions.md) — full details on every assertion type
- [Suite YAML Reference](../reference/suite-yaml.md) — every configuration option
- [Understanding Results](./understanding-results.md) — how to read and act on your scores
