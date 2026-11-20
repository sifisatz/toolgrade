import pc from "picocolors";
import type { Comparison, RegressionDelta } from "./compare.js";
import type { LintIssue } from "./lint.js";
import type { ArmSummary, GateCheck, OverallArm, RunReport } from "./runner.js";
import { pct, signedPct, type Difference, type Rate } from "./stats.js";

const ci = (r: Rate) => `${pct(r.low)}-${pct(r.high)}`;
const ciDiff = (d: Difference) => `${signedPct(d.low)}..${signedPct(d.high)}`;
const usd = (v: number | null) => (v === null ? "n/a" : `$${v.toFixed(v < 1 ? 4 : 2)}`);
// Relative % change (not percentage points, unlike signedPct): +20% means "20% more", fitting for
// a cost or latency delta rather than a rate difference.
const signedRelPct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
const regressionCell = (d: RegressionDelta | null, label: string) => (d ? ` ${label} ${colorRegression(d.deltaPct, signedRelPct(d.deltaPct))}` : "");
const rateCell = (a: ArmSummary) => `${pct(a.rate.rate)} (${a.rate.passes}/${a.rate.n})${a.errors ? ` +${a.errors} err` : ""}${a.infra ? ` +${a.infra} infra` : ""}`;
const overallCell = (a: OverallArm) => `${pct(a.rate.rate)} over ${a.rate.n} tasks (${a.trials.passed}/${a.trials.graded} trials)`;
const cost = (r: RunReport) => `${usd(r.totalCostUsd)}${r.costIsLowerBound ? " (lower bound: some trials errored)" : ""}`;

export function formatTerminal(r: RunReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(pc.bold(`ToolGrade - ${r.suite}`));
  if (r.provider === "scripted") lines.push(pc.yellow("SCRIPTED RUN - a script played the model; model names below are config only, no model was called"));
  lines.push(
    pc.dim(
      `provider ${r.provider} | agent ${r.agentModel} | judge ${r.judgeModel} | ${r.trialsPerTask} trial(s)/task | ${r.toolSurface.count} tools (~${r.toolSurface.approxTokens} tokens of schema) | surface ${r.toolSurface.fingerprint}`,
    ),
  );
  lines.push("");

  const header = ["task", "with tools", "baseline", "lift", "calls", "cost"];
  const rows = r.tasks.map((t) => [
    t.taskId,
    colorRate(t.tools.rate.rate, rateCell(t.tools)),
    t.baseline ? rateCell(t.baseline) : "-",
    t.lift ? colorLift(t.lift.delta, signedPct(t.lift.delta)) : "-",
    t.tools.meanToolCalls.toFixed(1),
    usd(t.tools.costUsd),
  ]);
  lines.push(...table([header.map((h) => pc.bold(h)), ...rows]));
  lines.push("");

  const o = r.overall;
  lines.push(`${pc.bold("Pass rate (tools)")}  ${colorRate(o.tools.rate.rate, overallCell(o.tools))}  95% CI ${ci(o.tools.rate)}`);
  if (o.baseline && o.lift) {
    lines.push(`${pc.bold("Pass rate (none) ")}  ${overallCell(o.baseline)}  95% CI ${ci(o.baseline.rate)}  ${pc.dim("outcome assertions only")}`);
    const sig = o.liftSignificance === "better" ? pc.green("significant") : o.liftSignificance === "worse" ? pc.red("significantly worse") : pc.yellow("not significant - add tasks");
    lines.push(`${pc.bold("Lift             ")}  ${colorLift(o.lift.delta, signedPct(o.lift.delta))}  95% CI ${ciDiff(o.lift)}  ${sig}`);
  }
  if (o.lift && o.liftTasks !== r.tasks.length) lines.push(pc.dim(`  lift over the ${o.liftTasks} task(s) graded in both arms`));
  lines.push(`${pc.bold("Cost             ")}  ${cost(r)} total (judge ${usd(r.judgeCostUsd)})`);
  if (r.unpricedModels.length) lines.push(pc.yellow(`No price for: ${r.unpricedModels.join(", ")} - add them under pricing: in the suite`));
  const infraTotal = r.trials.filter((t) => t.outcome === "infra").length;
  if (infraTotal) {
    lines.push(pc.yellow(`${infraTotal} of ${r.trials.length} trial(s) excluded as infra failures (rate-limit/budget/policy rejections) - not counted toward pass rate`));
  }

  const failures = r.trials.filter((t) => !t.passed && t.arm === "tools").slice(0, 8);
  if (failures.length) {
    lines.push("");
    lines.push(pc.bold("Failures (with tools)"));
    for (const f of failures) {
      const why = f.error ?? (f.trajectory?.incomplete ? `incomplete: ${f.trajectory.incomplete}` : f.assertions.filter((a) => !a.passed).map((a) => `${a.type}: ${a.detail}`).join("; "));
      lines.push(`  ${pc.red("x")} ${f.taskId}#${f.trial}  ${pc.dim(why)}`);
    }
  }

  lines.push("");
  for (const c of r.gate.checks) lines.push(`${c.passed ? pc.green("PASS") : pc.red("FAIL")} ${c.name}: ${c.detail}`);
  lines.push(r.gate.passed ? pc.green(pc.bold("Gate passed")) : pc.red(pc.bold("Gate failed")));
  return lines.join("\n");
}

export function formatMarkdown(r: RunReport, cmp?: Comparison): string {
  const o = r.overall;
  const out: string[] = [];
  out.push(`## ToolGrade: ${r.suite} - ${r.gate.passed ? "passed" : "FAILED"}`);
  out.push("");
  if (r.provider === "scripted") out.push("> Scripted run: a script played the model; no model was called.\n");
  out.push(`Provider \`${r.provider}\`, agent \`${r.agentModel}\`, judge \`${r.judgeModel}\`, ${r.trialsPerTask} trial(s) per task, ${r.toolSurface.count} tools (~${r.toolSurface.approxTokens} schema tokens).`);
  out.push("");
  out.push("| | Pass rate | 95% CI |");
  out.push("|---|---|---|");
  out.push(`| With tools | ${overallCell(o.tools)} | ${ci(o.tools.rate)} |`);
  if (o.baseline && o.lift) {
    out.push(`| No tools (baseline, outcomes only) | ${overallCell(o.baseline)} | ${ci(o.baseline.rate)} |`);
    out.push(`| **Lift** | **${signedPct(o.lift.delta)}** | ${ciDiff(o.lift)} (${o.liftSignificance?.replace("_", " ")}) |`);
  }
  out.push("");
  out.push("| Task | With tools | Baseline | Lift | Mean tool calls |");
  out.push("|---|---|---|---|---|");
  for (const t of r.tasks) {
    out.push(`| \`${t.taskId}\` | ${rateCell(t.tools)} | ${t.baseline ? rateCell(t.baseline) : "-"} | ${t.lift ? signedPct(t.lift.delta) : "-"} | ${t.tools.meanToolCalls.toFixed(1)} |`);
  }
  if (cmp) {
    out.push("");
    out.push(`### Versus previous run: ${cmp.verdict.replaceAll("_", " ")}`);
    if (cmp.toolSurface.changed) {
      out.push("");
      out.push("> **Tool surface changed since the previous run** - any difference below may be explained by that, not by anything else.");
      if (cmp.toolSurface.added.length) out.push(`> - added: ${cmp.toolSurface.added.map((n) => `\`${n}\``).join(", ")}`);
      if (cmp.toolSurface.removed.length) out.push(`> - removed: ${cmp.toolSurface.removed.map((n) => `\`${n}\``).join(", ")}`);
      if (cmp.toolSurface.changedTools.length) out.push(`> - changed: ${cmp.toolSurface.changedTools.map((n) => `\`${n}\``).join(", ")}`);
      out.push("");
    }
    out.push(`Pass rate ${pct(cmp.overall.before)} -> ${pct(cmp.overall.after)} (${signedPct(cmp.overall.diff.delta)}, 95% CI ${ciDiff(cmp.overall.diff)}).`);
    const moved = cmp.tasks.filter((t) => t.significance !== "not_significant");
    for (const t of moved) {
      const cost = t.costDelta ? `, cost ${signedRelPct(t.costDelta.deltaPct)}` : "";
      const latency = t.durationDelta ? `, latency ${signedRelPct(t.durationDelta.deltaPct)}` : "";
      out.push(`- \`${t.taskId}\`: ${pct(t.before)} -> ${pct(t.after)} (${t.significance})${cost}${latency}`);
    }
  }
  out.push("");
  const infraTotal = r.trials.filter((t) => t.outcome === "infra").length;
  if (infraTotal) out.push(`> ${infraTotal} of ${r.trials.length} trial(s) excluded as infra failures (rate-limit/budget/policy rejections) - not counted toward pass rate.\n`);
  out.push(`Cost: ${cost(r)}. Gate: ${r.gate.checks.map((c) => `${c.name} ${c.passed ? "ok" : "FAILED"}`).join(", ")}.`);
  return out.join("\n");
}

export function formatComparison(cmp: Comparison, checks: GateCheck[] = []): string {
  const lines = [pc.bold(`Comparison: ${cmp.verdict.replaceAll("_", " ")}`)];
  if (cmp.toolSurface.changed) {
    lines.push(pc.yellow("tool surface changed since the previous run - treat this comparison with caution"));
    if (cmp.toolSurface.added.length) lines.push(pc.yellow(`  added: ${cmp.toolSurface.added.join(", ")}`));
    if (cmp.toolSurface.removed.length) lines.push(pc.yellow(`  removed: ${cmp.toolSurface.removed.join(", ")}`));
    if (cmp.toolSurface.changedTools.length) lines.push(pc.yellow(`  changed: ${cmp.toolSurface.changedTools.join(", ")}`));
  }
  lines.push(`overall over ${cmp.overall.tasks} matched tasks ${pct(cmp.overall.before)} -> ${pct(cmp.overall.after)}  ${signedPct(cmp.overall.diff.delta)}  95% CI ${ciDiff(cmp.overall.diff)}`);
  lines.push(pc.dim("per-task verdicts are Bonferroni-corrected"));
  for (const t of cmp.tasks) {
    const tag = t.significance === "worse" ? pc.red("worse") : t.significance === "better" ? pc.green("better") : pc.dim("~");
    const cost = regressionCell(t.costDelta, "cost");
    const latency = regressionCell(t.durationDelta, "latency");
    lines.push(`  ${t.taskId.padEnd(28)} ${pct(t.before).padStart(4)} -> ${pct(t.after).padStart(4)}  ${tag}${cost}${latency}`);
  }
  if (cmp.unmatched.length) lines.push(pc.yellow(`not in both runs: ${cmp.unmatched.join(", ")}`));
  if (checks.length) {
    lines.push("");
    for (const c of checks) lines.push(`${c.passed ? pc.green("PASS") : pc.red("FAIL")} ${c.name}: ${c.detail}`);
  }
  return lines.join("\n");
}

export function formatLint(issues: LintIssue[], toolCount: number): string {
  if (issues.length === 0) return pc.green(`${toolCount} tools, no lint issues`);
  return issues.map((i) => `${i.level === "error" ? pc.red("error") : pc.yellow("warn ")} ${i.tool}: ${i.message}`).join("\n");
}

function colorRate(rate: number, text: string): string {
  return rate >= 0.8 ? pc.green(text) : rate >= 0.5 ? pc.yellow(text) : pc.red(text);
}

function colorLift(delta: number, text: string): string {
  return delta > 0 ? pc.green(text) : delta < 0 ? pc.red(text) : pc.dim(text);
}

/** Opposite sense from colorLift: for cost/latency, an increase is bad and a decrease is good. */
function colorRegression(deltaPct: number, text: string): string {
  return deltaPct > 0 ? pc.red(text) : deltaPct < 0 ? pc.green(text) : pc.dim(text);
}

// Pads on visible width so ANSI colour codes do not break alignment.
function table(rows: string[][]): string[] {
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => visible(r[i] ?? ""))));
  return rows.map((r) => r.map((cell, i) => cell + " ".repeat(widths[i]! - visible(cell))).join("  "));
}
