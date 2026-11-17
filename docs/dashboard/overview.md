# Dashboard Overview

The ToolGrade dashboard is a web platform for viewing evaluation history, tracking quality trends over time, and managing your team. It lives at [app.toolgrade.dev](https://app.toolgrade.dev).

---

## Getting started

### Create an account

Go to [app.toolgrade.dev/sign-up](https://app.toolgrade.dev/sign-up) and enter your name, email, and a password (minimum 10 characters).

### Create your workspace and first project

After sign-up, you're taken to the onboarding page:

1. Enter a **workspace name** — this is your organization (e.g., "Acme Corp" or your personal name)
2. Enter a **project name** — a project maps to one MCP server or suite (e.g., "notes-server")
3. Click **Create**

You're taken to the project's Settings page, ready to [connect CI](../guides/ci-github-actions.md).

---

## Navigation structure

```
Workspace (org)
├── Overview                 — all projects at a glance
├── Members                  — team management
└── Project
    ├── Dashboard            — KPIs and trend charts
    ├── Runs                 — full run history
    │   └── Run detail       — per-task breakdown and trial inspector
    ├── Compare              — run-vs-run statistical comparison
    ├── Model Matrix         — cross-model performance table
    └── Settings             — API keys, CI setup, billing
```

---

## Workspace overview

**URL:** `/app/[org]`

Lists all projects in your workspace with their latest stats:
- **Pass rate** — latest run pass rate with 95% confidence interval
- **Lift** — latest lift over baseline
- **Cost/run** — latest run cost

Also shows workspace-level KPIs:
- Total projects
- Total runs recorded
- Failing gates (projects where the last run failed the gate)

If you have multiple workspaces, switch between them from the account menu in the top-right corner.

---

## Project dashboard

**URL:** `/app/[org]/[project]`

The main view for a single project. Shows:

### KPI tiles
- **Pass rate** — latest run, with 95% CI range
- **Lift** — latest lift over no-tool baseline, with significance indicator
- **Gate** — latest gate status (PASSED / FAILED)
- **Cost/run** — latest run total cost in USD

### Pass rate trend chart
Interactive line chart of pass rate over your last N runs. Click any data point to open that run's detail page.

### Lift trend chart
Lift over time. A declining trend before you've made any changes usually means prompt drift or model updates affecting your tools.

### Recent runs
A compact table of the last 5 runs with quick-access links.

---

## Understanding the demo workspace

If you don't have runs yet, click **Explore the demo workspace** on the sign-in page to see a fully populated example. The demo shows realistic data for a notes server with 12 runs over time, including one regression event.

---

## Next steps

- [Projects & Runs](./projects-runs.md) — diving into run details and comparisons
- [Settings & Billing](./settings-billing.md) — API keys, plans, and team management
- [GitHub Actions Integration](../guides/ci-github-actions.md) — start sending real run data
