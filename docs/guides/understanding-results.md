# Understanding Results

ToolGrade produces a lot of numbers. Here's what they all mean and how to act on them.

---

## The key metrics

### Pass rate

The percentage of task-trials that passed all assertions, in the **with-tools arm**.

```
Pass rate: 87% [78%–96%]
```

The brackets are the **95% confidence interval** — a range that the true underlying pass rate is very likely to fall within. A wide interval means your trial count is low; run more trials to narrow it.

**What's a good pass rate?**  
It depends on your tasks and risk tolerance. A CRUD server on simple tasks might target 90%+. A server handling complex multi-step reasoning might consider 70% excellent. Set your `min_pass_rate` gate based on what you observe and what your users will experience.

---

### Baseline rate

The percentage of task-trials that passed all outcome assertions in the **no-tools arm** (the agent couldn't use any tools).

```
Baseline: 23% [13%–37%]
```

A low baseline is expected — that's the whole point. If your baseline rate is high (say, 80%), it means either:
- Your tasks are too easy and the model can answer them from its training data
- Your assertions are too lenient and don't require tool use to pass

A healthy baseline for a tool-heavy server is usually under 40%.

---

### Lift

The difference between pass rate and baseline rate.

```
Lift: +64pp (95% CI: +47pp–+77pp)
```

Lift is the most important number. It measures the marginal value your tools add.

| Lift | Interpretation |
|---|---|
| **+40pp or more** | Strong signal — your tools provide substantial value |
| **+20pp to +40pp** | Good signal — real but modest improvement |
| **+5pp to +20pp** | Weak signal — tools help but maybe not enough to justify cost |
| **Near 0** | No significant effect — reconsider tool descriptions or tasks |
| **Negative** | Your tools are actively hurting performance — investigate |

The 95% CI on lift uses the Newcombe hybrid score method. If the CI includes 0, the lift is not statistically significant.

---

### Gate checks

Gates are thresholds defined in your `toolgrade.yaml`. When a gate fails, the CLI exits with code 1, which fails CI.

```
Gate checks:
  ✅  min_pass_rate  0.87 ≥ 0.80
  ✅  min_lift       0.64 ≥ 0.30
```

You configure these in your suite:
```yaml
gate:
  min_pass_rate: 0.80  # pass rate must be at least 80%
  min_lift: 0.30       # lift must be at least 30 percentage points
```

Both thresholds must pass for the overall gate to pass. Set them conservatively at first — you can tighten them once you have baseline data.

---

### Cost

```
Cost: $0.021
```

Total inference cost for all trials in the run, using list pricing for the configured model. Unknown models show `n/a`.

For CI budgeting: a typical 10-task suite with 3 trials costs roughly $0.01–$0.05 per run with mid-tier Claude models.

---

## Per-task breakdown

Each task in the report shows:

| Column | Meaning |
|---|---|
| **Pass rate** | % of trials that passed, with-tools arm |
| **Baseline** | % of trials that passed, no-tools arm |
| **Lift** | Difference (pass rate − baseline) |
| **Tool calls** | Mean number of tool calls across trials |
| **Status** | ✅ All passed / ⚠️ Partial / ❌ All failed |

The dumbbell visualization (in the dashboard) shows the range from baseline to pass rate visually, making it easy to spot which tasks are driving value and which aren't.

---

## The trial inspector

Each trial is a single agent run. In the dashboard's trial inspector, you can see:

- The full tool call trace (tool name, arguments, response)
- Which assertions passed or failed, and why
- The agent's final answer
- Token usage for that trial

This is the most useful debugging view. If a task has a low pass rate, open the inspector to see what's going wrong.

---

## Understanding the comparison report

When you run with `--compare <previous-report>`:

```
Comparison verdict: REGRESSED

Task verdicts (Bonferroni-corrected, α=0.05):
  create-note     no significant change
  list-notes      REGRESSED  (old: 100%, new: 33%, Δ=-67pp)
  delete-note     no significant change
  control         no significant change
```

The comparison uses **Bonferroni correction** — a statistical adjustment that prevents false positives when testing many tasks simultaneously. This means: a task needs to regress *substantially* to register as `REGRESSED`, not just slip by one trial out of three.

| Verdict | Meaning |
|---|---|
| `improved` | At least one task significantly improved, none regressed |
| `no_significant_change` | No statistically significant changes |
| `regressed` | At least one task significantly regressed |

The CLI exits with code 1 on `regressed`.

**Tool surface warning:** If the comparison detects that tool names, descriptions, or schemas changed between runs (different fingerprint), it shows a warning. This doesn't block the comparison but explains why results changed.

---

## Common patterns and what they mean

### High pass rate, low lift
Your tasks may be too easy. The model can answer them from general knowledge even without tools. Revise prompts to require server-specific data the model couldn't know.

### Low pass rate, high lift
Your tools are providing real value but something is preventing consistent success. Check the trial inspector: are tools being called with wrong arguments? Is the server returning unexpected formats?

### High baseline rate on control tasks, low elsewhere
The agent and judge are working. The issue is specific to your server or its tool descriptions.

### Flapping results (varies wildly across runs)
Increase `trials` to 5 or more. With 3 trials, a single bad run shifts the pass rate by 33 percentage points.

### Negative lift
Your tools are making things worse. Common causes:
- Too many tools — the model is confused about which to use
- Poorly named tools — descriptions don't match what the tool actually does
- Conflicting tool names — similar tools with subtle differences
- The agent calls tools that return errors and gets confused

---

## Next steps

- [Writing Your First Suite](./writing-your-first-suite.md) — write better tasks
- [Assertions Reference](../reference/assertions.md) — more precise assertions
- [Dashboard: Projects & Runs](../dashboard/projects-runs.md) — view trends over time
