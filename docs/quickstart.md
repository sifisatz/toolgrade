# 5-Minute Quickstart

You have an MCP server. You want to know if it's working. Let's find out.

**Prerequisites:** Node.js 20+, an MCP server you can run locally, and an `ANTHROPIC_API_KEY` (or see [Using Ollama Locally](./guides/using-ollama-locally.md) for a free alternative).

---

## Step 1: Generate a starter suite

Point ToolGrade at your server and let it read the tools:

```bash
# For a stdio server (subprocess):
npx toolgrade init -- node path/to/your/server.js

# For an HTTP server:
npx toolgrade init --url http://localhost:3000/mcp
```

This creates a `toolgrade.yaml` file with one task stub per tool, plus a no-tool control task. It looks like this:

```yaml
name: my-server

server:
  command: node
  args: [path/to/your/server.js]

agent:
  model: claude-sonnet-5

run:
  trials: 3

gate:
  min_pass_rate: 0.8
  min_lift: 0.3

tasks:
  - id: create-note
    prompt: "TODO: describe a task that uses the create_note tool"
    assert:
      - type: tool_called
        tool: create_note
      - type: output_contains
        value: "TODO: something the answer should contain"

  - id: control-no-tools
    prompt: "TODO: a task the model can answer without tools"
    assert:
      - type: output_contains
        value: "TODO: expected content"
```

---

## Step 2: Fill in the TODOs

Edit `toolgrade.yaml` and replace every `TODO:` placeholder with real prompts and assertions.

**A good task:**
- Has a clear, concrete prompt (not vague instructions)
- Asserts something that can only be true if the agent actually used the tool correctly
- Checks the *outcome*, not just that a tool was called

**Example before:**
```yaml
- id: create-note
  prompt: "TODO: describe a task that uses the create_note tool"
  assert:
    - type: tool_called
      tool: create_note
```

**Example after:**
```yaml
- id: create-note
  prompt: "Create a note with the title 'Meeting recap' and body 'Discussed Q4 goals'"
  assert:
    - type: tool_called
      tool: create_note
    - type: state
      tool: get_note
      args: { title: "Meeting recap" }
      output_contains: ["Q4 goals"]
```

The `state` assertion calls `get_note` after the agent finishes and checks the actual server state — so a hallucinated answer can't pass.

---

## Step 3: Run the evaluation

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx toolgrade run toolgrade.yaml
```

You'll see progress as trials run, then a summary:

```
toolgrade v0.x.x  ·  my-server  ·  claude-sonnet-5

  create-note     ████████░░  3/3 ✓  baseline 0/3 ✗
  get-notes       ████████░░  3/3 ✓  baseline 1/3 ✗
  delete-note     ████████░░  2/3 ✓  baseline 0/3 ✗
  control         ████████████  3/3 ✓  baseline 3/3 ✓

  Pass rate:  89% [78%–96%]
  Baseline:   33% [19%–51%]
  Lift:       +56pp
  Cost:       $0.021

  Gate checks:
    ✅  min_pass_rate  0.89 ≥ 0.80
    ✅  min_lift       0.56 ≥ 0.30

  PASSED  ·  report: .toolgrade/runs/2026-01-15T14:23:00.json
```

---

## Step 4: Upload to the dashboard (optional)

Create a free account at [app.toolgrade.dev](https://app.toolgrade.dev), create a project, generate an API key in Settings, then:

```bash
npx toolgrade run toolgrade.yaml --upload https://app.toolgrade.dev
```

Your run history, trend charts, and run comparisons are now available in the dashboard.

---

## Step 5: Wire up CI

Add these two secrets to your GitHub repository:
- `TOOLGRADE_API_KEY` — from your project Settings page
- `ANTHROPIC_API_KEY` — your Anthropic key

Create `.github/workflows/toolgrade.yml`:

```yaml
name: ToolGrade

on:
  pull_request:
    branches: [main]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: toolgrade/toolgrade@v0
        with:
          suite: toolgrade.yaml
          upload-url: https://app.toolgrade.dev
          baseline-url: https://app.toolgrade.dev
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          TOOLGRADE_API_KEY: ${{ secrets.TOOLGRADE_API_KEY }}
```

Every pull request now runs your eval suite. If a change drops your quality below the gate threshold, CI fails.

---

## What's next?

- [Writing Your First Suite](./guides/writing-your-first-suite.md) — how to write tasks that catch real regressions
- [Understanding Results](./guides/understanding-results.md) — what all the numbers mean
- [Assertions Reference](./reference/assertions.md) — every assertion type with examples
- [Suite YAML Reference](./reference/suite-yaml.md) — full configuration options
