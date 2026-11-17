# What is ToolGrade?

> You don't need to know what an MCP server is to understand this page.

---

## The problem it solves

Imagine you're a chef. You've just hired a sous-chef (an AI agent) to handle prep work. You give them a set of knives and gadgets (tools), point them at a pile of recipes (tasks), and walk away.

A week later, you check in. How do you know if the tools actually helped? Maybe they cooked everything fine — but would they have done just as well with a plain cutting board? Maybe the gadgets slowed them down. Maybe one specific knife caused more problems than it solved.

**That's the question ToolGrade answers for AI tools.**

---

## What is an MCP server?

MCP stands for **Model Context Protocol** — a standard way to give AI agents access to external capabilities: reading files, searching a database, calling an API, managing a calendar, sending messages, and so on.

When you build an MCP server, you're giving an AI agent a set of tools it can call during a conversation. The agent decides when to use them, how to use them, and how to interpret their results.

This is powerful. But it also means:
- More tools = more tokens in every request = higher cost
- More tools = more chances for the agent to call the wrong one
- A poorly described tool is worse than no tool at all

ToolGrade helps you know *before* you ship whether your tools are helping or hurting.

---

## How ToolGrade works

ToolGrade runs your AI agent through a series of real tasks — things like "summarize these notes" or "delete the entry for user 42" — and measures whether it succeeds.

The clever part: it runs every task **twice**.

```
Task: "Find all notes tagged 'urgent' and summarize them."

Run 1 → Agent with your tools  → passes or fails
Run 2 → Agent, no tools        → passes or fails
```

The difference between those two pass rates is called the **lift**. If your tools help, lift is positive. If your tools don't help (or hurt), lift is near zero or negative.

You set a minimum lift threshold. If a future change drops your lift below that threshold, CI fails automatically and you know something broke before it ships.

---

## What ToolGrade is not

- **Not a unit testing framework.** It doesn't mock your server — it connects to the real thing.
- **Not a benchmark.** It measures *your* tools against *your* tasks, not against anyone else's server.
- **Not only for experts.** You can be up and running in 5 minutes with `npx toolgrade init`.

---

## The two parts

ToolGrade has two main parts:

### 1. The CLI (`npx toolgrade`)
A command-line tool you run locally or in CI. It connects to your MCP server, runs your evaluation suite, and produces a report.

```bash
npx toolgrade run toolgrade.yaml
```

### 2. The Dashboard
A web platform at [app.toolgrade.dev](https://app.toolgrade.dev) where you can:
- View run history with charts and trends
- Compare runs before and after a change
- See which tools are actually being called (and which aren't)
- Manage your team and billing

You don't need the dashboard to use the CLI. But together they give you a complete quality picture over time.

---

## A quick example

Say you've built an MCP server for a note-taking app. You want to know: does giving the agent your tools actually help it manage notes better?

You write a suite with tasks like:
- "Create a note titled 'Shopping list' with the contents 'milk, eggs, bread'"
- "Find all notes from last week and return their titles"
- "Delete the note titled 'Draft - DO NOT PUBLISH'"

ToolGrade runs each task multiple times (by default 3 trials), with and without your tools, and tells you:

- **Pass rate (with tools):** 87% (with 95% confidence interval: 78%–93%)
- **Baseline rate (no tools):** 23%
- **Lift:** +64 percentage points
- **Gate:** ✅ PASSED

That's a tool suite worth shipping. If a future change drops the lift to +10 percentage points, the gate fails and you investigate before it reaches users.

---

## Ready to try it?

→ [5-Minute Quickstart](./quickstart.md)
