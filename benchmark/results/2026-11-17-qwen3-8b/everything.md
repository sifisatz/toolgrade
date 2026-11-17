## ToolGrade: server-everything@2.3.0 - passed

Provider `openai-compatible`, agent `qwen3:8b`, judge `qwen3:8b`, 3 trial(s) per task, 16 tools (~1638 schema tokens).

| | Pass rate | 95% CI |
|---|---|---|
| With tools | 56% over 6 tasks (10/18 trials) | 22%-85% |
| No tools (baseline, outcomes only) | 22% over 6 tasks (4/18 trials) | 5%-61% |
| **Lift** | **+33pp** | -18pp..+67pp (not significant) |

| Task | With tools | Baseline | Lift | Mean tool calls |
|---|---|---|---|---|
| `hidden-config` | 100% (3/3) | 0% (0/3) | +100pp | 1.0 |
| `masked-secret` | 100% (3/3) | 0% (0/3) | +100pp | 1.0 |
| `chicago-weather` | 0% (0/3) | 0% (0/3) | +0pp | 0.0 |
| `resource-seven` | 67% (2/3) | 0% (0/3) | +67pp | 1.0 |
| `exact-sum` | 33% (1/3) | 33% (1/3) | +0pp | 1.0 |
| `no-tool-needed` | 33% (1/3) | 100% (3/3) | -67pp | 0.7 |

Cost: $0.0000. Gate: no_errors ok.