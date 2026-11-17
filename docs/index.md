# ToolGrade Documentation

> **Does your AI tool actually help?** ToolGrade gives you a statistically rigorous answer.

---

## Welcome

ToolGrade is an evaluation platform for MCP (Model Context Protocol) servers — the layer that gives AI agents access to tools like file systems, databases, APIs, and more.

If you've built or are evaluating MCP tools, ToolGrade answers the most important question: **does your tool surface make an AI agent better at real tasks, or is it just adding noise?**

---

## Where to start

### "I'm new here — what is this?"
→ [What is ToolGrade?](./what-is-toolgrade.md)

### "Show me how to run my first evaluation"
→ [5-Minute Quickstart](./quickstart.md)

### "I want to write a proper test suite"
→ [Writing Your First Suite](./guides/writing-your-first-suite.md)

### "I want to wire this into GitHub CI"
→ [GitHub Actions Integration](./guides/ci-github-actions.md)

### "What do my results actually mean?"
→ [Understanding Results](./guides/understanding-results.md)

### "I want to run evals locally with Ollama (no API key)"
→ [Using Ollama Locally](./guides/using-ollama-locally.md)

---

## Reference

| Section | Contents |
|---|---|
| [CLI Reference](./reference/cli.md) | All commands and flags |
| [Suite YAML Reference](./reference/suite-yaml.md) | Full `toolgrade.yaml` schema |
| [Assertions Reference](./reference/assertions.md) | Every assertion type with examples |
| [Platform API Reference](./reference/api.md) | REST API for CI integrations |

---

## Dashboard

| Section | Contents |
|---|---|
| [Dashboard Overview](./dashboard/overview.md) | Navigating the web platform |
| [Projects & Runs](./dashboard/projects-runs.md) | Understanding project data and run history |
| [Settings & Billing](./dashboard/settings-billing.md) | API keys, plans, and team management |

---

## At a glance

```
Your MCP Server
      │
      ▼
toolgrade run toolgrade.yaml
      │
      ├── ARM 1: Agent + your tools ──▶ Did it pass?
      └── ARM 2: Agent, no tools   ──▶ Did it pass?
                                              │
                                              ▼
                              Lift = (with tools) − (no tools)
                              Gate = fails CI if lift drops below threshold
```

ToolGrade runs every task twice — once with your tools, once without — so your quality metric is never confused with what the model already knew how to do on its own.

---

*Something missing or confusing? Open an issue at [github.com/sifisatz/toolgrade](https://github.com/sifisatz/toolgrade).*
