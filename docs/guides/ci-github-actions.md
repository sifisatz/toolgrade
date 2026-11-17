# GitHub Actions Integration

Wire ToolGrade into your CI pipeline so every pull request automatically evaluates your tools and fails if quality drops.

---

## Prerequisites

- A `toolgrade.yaml` suite file committed to your repository
- A ToolGrade account and project at [app.toolgrade.dev](https://app.toolgrade.dev) (free tier works)
- An Anthropic API key (or see [Using Ollama Locally](./using-ollama-locally.md) for a free option)

---

## Step 1: Create a project API key

1. Sign in to [app.toolgrade.dev](https://app.toolgrade.dev)
2. Navigate to your project → **Settings**
3. Under **API Keys**, click **New key**
4. Give it a name like `github-ci`
5. Copy the key — it's shown only once

---

## Step 2: Add secrets to GitHub

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add two secrets:
- `TOOLGRADE_API_KEY` — the key you just created
- `ANTHROPIC_API_KEY` — your Anthropic key

---

## Step 3: Create the workflow

Create `.github/workflows/toolgrade.yml` in your repository:

```yaml
name: ToolGrade Eval

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

That's it. Push this file to your repo and open a pull request to test it.

---

## What happens on each pull request

1. The action checks out your code and installs the latest ToolGrade CLI
2. It runs `toolgrade run toolgrade.yaml` with your suite
3. The report is uploaded to the dashboard
4. It fetches the **baseline** — the most recent run on the base branch (`main`) — and runs a statistical comparison
5. If the comparison verdict is `regressed`, the step fails and blocks the PR merge

The PR page shows a CI check called "ToolGrade Eval". Clicking **Details** takes you to the run log. The dashboard link in the log takes you to the full visual report.

---

## Action inputs reference

| Input | Required | Default | Description |
|---|---|---|---|
| `suite` | ✅ | — | Path to `toolgrade.yaml` |
| `upload-url` | — | — | Dashboard URL to upload results to |
| `baseline-url` | — | — | Dashboard URL to fetch baseline from |
| `trials` | — | suite setting | Override trial count |
| `concurrency` | — | suite setting | Override concurrency |
| `filter` | — | — | Only run tasks matching id or tag |
| `no-baseline` | — | false | Skip the no-tools arm |
| `model` | — | suite setting | Override agent model |
| `judge-model` | — | suite setting | Override judge model |
| `provider` | — | `anthropic` | `anthropic` or `openai` |
| `base-url` | — | Ollama default | Base URL for openai provider |
| `api-key-env` | — | `OPENAI_API_KEY` | Env var name for openai provider key |
| `local-model` | — | false | Treat model as $0 cost |

---

## Action outputs

| Output | Description |
|---|---|
| `report` | Path to the full JSON report (`.toolgrade/runs/latest.json`) |
| `markdown` | Path to the Markdown summary (`.toolgrade/summary.md`) |

You can use these outputs in subsequent steps, for example to post the Markdown summary as a PR comment:

```yaml
- uses: toolgrade/toolgrade@v0
  id: eval
  with:
    suite: toolgrade.yaml
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    TOOLGRADE_API_KEY: ${{ secrets.TOOLGRADE_API_KEY }}

- name: Comment on PR
  if: always()
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs')
      const summary = fs.readFileSync('${{ steps.eval.outputs.markdown }}', 'utf8')
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: summary
      })
```

---

## Baseline branch matching

By default, the action reads `GITHUB_BASE_REF` (the branch a PR targets) and uses it as the baseline filter when fetching from the dashboard. This means:

- A PR targeting `main` compares against the last run on `main`
- A PR targeting `staging` compares against the last run on `staging`

Override this with `--baseline-branch <branch>` if you need custom behavior.

If no matching baseline run exists yet (e.g., first run on the project), the comparison step is skipped and the run is uploaded as the new baseline.

---

## Running on pushes to main

To also record runs on the base branch (required for baseline comparisons to work):

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

The push to `main` creates the baseline run. The PR comparison then has something to compare against.

---

## Skipping evals for non-code changes

If your suite only tests server behavior, you can skip evals for documentation-only PRs:

```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'src/**'
      - 'toolgrade.yaml'
```

---

## Cost management

Each PR eval costs roughly $0.01–$0.10 depending on suite size and model. To reduce costs in CI:

1. **Use a faster/cheaper model for CI:**
   ```yaml
   with:
     model: claude-haiku-4-5-20251001
   ```

2. **Reduce trials:**
   ```yaml
   with:
     trials: "1"
   ```

3. **Run only tagged tasks in CI:**
   ```yaml
   with:
     filter: critical
   ```

4. **Use Ollama with a self-hosted runner** — zero LLM cost. See [Using Ollama Locally](./using-ollama-locally.md).

---

## Troubleshooting

**"No baseline found, skipping comparison"**  
You need at least one successful run on the base branch. Trigger a push to `main` to create the first baseline.

**"TOOLGRADE_API_KEY is invalid or expired"**  
Check that the secret name in GitHub matches exactly and that the key hasn't been revoked in Settings.

**CI passes but gate should have failed**  
Make sure `gate.min_pass_rate` and `gate.min_lift` are set in your `toolgrade.yaml`. Without gates configured, the CLI always exits 0.

**High API costs**  
Check `run.concurrency` in your suite — higher concurrency means more parallel API calls. The default is 4; lower it if costs are a concern.
