## ToolGrade: excel-mcp-server@2.3.2 - passed

Provider `openai-compatible`, agent `qwen3:8b`, judge `qwen3:8b`, 3 trial(s) per task, 46 tools (~13545 schema tokens).

| | Pass rate | 95% CI |
|---|---|---|
| With tools | 20% over 5 tasks (3/15 trials) | 4%-62% |
| No tools (baseline, outcomes only) | 20% over 5 tasks (3/15 trials) | 4%-62% |
| **Lift** | **+0pp** | -45pp..+45pp (not significant) |

| Task | With tools | Baseline | Lift | Mean tool calls |
|---|---|---|---|---|
| `top-customer` | 0% (0/3) | 0% (0/3) | +0pp | 2.3 |
| `pending-total` | 0% (0/3) | 0% (0/3) | +0pp | 1.3 |
| `mark-shipped` | 0% (0/3) | 0% (0/3) | +0pp | 0.0 |
| `add-order` | 0% (0/3) | 0% (0/3) | +0pp | 0.0 |
| `no-tool-needed` | 100% (3/3) | 100% (3/3) | +0pp | 0.0 |

Cost: $0.0000. Gate: no_errors ok.