## ToolGrade: mcp-pandoc@0.11.1 - passed

Provider `openai-compatible`, agent `qwen3:8b`, judge `qwen3:8b`, 3 trial(s) per task, 1 tools (~1503 schema tokens).

| | Pass rate | 95% CI |
|---|---|---|
| With tools | 60% over 5 tasks (9/15 trials) | 23%-88% |
| No tools (baseline, outcomes only) | 100% over 5 tasks (15/15 trials) | 57%-100% |
| **Lift** | **-40pp** | -77pp..+12pp (not significant) |

| Task | With tools | Baseline | Lift | Mean tool calls |
|---|---|---|---|---|
| `markdown-to-html` | 33% (1/3) | 100% (3/3) | -67pp | 2.0 |
| `html-to-markdown` | 67% (2/3) | 100% (3/3) | -33pp | 1.0 |
| `list-conversion` | 100% (3/3) | 100% (3/3) | +0pp | 1.0 |
| `markdown-to-latex` | 0% (0/3) | 100% (3/3) | -100pp | 1.3 |
| `no-tool-needed` | 100% (3/3) | 100% (3/3) | +0pp | 0.0 |

Cost: $0.0000. Gate: no_errors ok.