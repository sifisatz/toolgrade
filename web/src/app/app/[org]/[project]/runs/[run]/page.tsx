import {
  CircleAlert,
  CircleCheck,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Dumbbell, DumbbellLegend } from "@/components/dumbbell";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import {
  DemoBadge,
  GateBadge,
  Lift,
  SignificanceBadge,
} from "@/components/status";
import { ToolCoverageCard } from "@/components/tool-coverage-card";
import { TrialSheet } from "@/components/trial-sheet";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPreviousRunId, getProject, getRun } from "@/lib/data";
import { dateTime, pct, shortSha, signedPct, usd } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { toolSurfaceBreakdown } from "@/lib/tool-surface";
import { forClient } from "@/lib/trim";

export const metadata = { title: "Run" };

export default function RunPage({
  params,
}: PageProps<"/app/[org]/[project]/runs/[run]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <RunDetail params={params} />
    </Suspense>
  );
}

async function RunDetail({
  params,
}: {
  params: Promise<{ org: string; project: string; run: string }>;
}) {
  const { org: orgSlug, project: projectSlug, run: runId } = await params;
  const user = await requireUser();
  const found = await getProject(user.id, orgSlug, projectSlug);
  if (!found) notFound();
  const { project, org } = found;
  const run = await getRun(project.id, runId);
  if (!run) notFound();
  const previousId = await getPreviousRunId(project.id, run.createdAt);
  const r = run.report;
  const o = r.overall;
  const base = `/app/${org.slug}/${project.slug}`;
  const toolSurface = toolSurfaceBreakdown(r);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: org.name, href: `/app/${org.slug}` },
          { label: project.name, href: base },
          { label: `Run ${shortSha(run.commit)}` },
        ]}
        title={run.commitMessage ?? `Run ${run.id.slice(0, 8)}`}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1 font-mono">
              <GitCommitHorizontal className="size-4" aria-hidden />
              {shortSha(run.commit)}
            </span>
            {run.branch && (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-4" aria-hidden />
                {run.branch}
              </span>
            )}
            <span>{dateTime(run.createdAt)}</span>
            <span className="font-mono">
              {r.agentModel} via {r.provider}
            </span>
            {run.source === "demo" && <DemoBadge />}
          </span>
        }
        actions={
          <>
            <GateBadge passed={run.gatePassed} className="text-sm" />
            {previousId && (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={`${base}/compare?base=${previousId}&head=${run.id}`}
                  />
                }
              >
                <GitCompareArrows /> Compare with previous
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Pass rate with tools"
            value={pct(o.tools.rate.rate)}
            sub={`95% CI ${pct(o.tools.rate.low)}-${pct(o.tools.rate.high)} - ${o.tools.trials.passed}/${o.tools.trials.graded} trials`}
          />
          <StatTile
            label="No-tool baseline"
            value={o.baseline ? pct(o.baseline.rate.rate) : "n/a"}
            sub="graded on outcome assertions only"
          />
          <StatTile
            label="Lift"
            value={<Lift value={o.lift?.delta} />}
            sub={
              o.lift ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  CI {signedPct(o.lift.low)}..{signedPct(o.lift.high)}{" "}
                  <SignificanceBadge value={o.liftSignificance} />
                </span>
              ) : (
                "no baseline"
              )
            }
          />
          <StatTile
            label="Cost"
            value={usd(r.totalCostUsd)}
            sub={
              r.costIsLowerBound
                ? "lower bound - some trials errored"
                : `judge ${usd(r.judgeCostUsd)} - ${r.toolSurface.count} tools, ~${r.toolSurface.approxTokens} schema tokens`
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Gate</CardTitle>
            <CardDescription>
              The checks that decide this run's CI exit code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-3">
              {r.gate.checks.map((c) => (
                <li
                  key={c.name}
                  className="flex items-start gap-2 rounded-lg border p-3 text-sm"
                >
                  {c.passed ? (
                    <CircleCheck
                      className="mt-0.5 size-4 shrink-0 text-status-good"
                      aria-label="passed"
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-status-critical"
                      aria-label="failed"
                    />
                  )}
                  <div>
                    <div className="font-mono text-xs font-medium">
                      {c.name}
                    </div>
                    <div className="text-muted-foreground">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="gap-2 pb-2">
          <CardHeader className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <CardTitle>Tasks</CardTitle>
              <CardDescription className="mt-1">
                {r.trialsPerTask} trials per task and arm. Inspect a task to see
                every trial's tool calls and how it was graded.
              </CardDescription>
            </div>
            <DumbbellLegend />
          </CardHeader>
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead className="w-[28%]">Baseline to tools</TableHead>
                  <TableHead className="text-right">With tools</TableHead>
                  <TableHead className="text-right">Baseline</TableHead>
                  <TableHead className="text-right">Lift</TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    Tool calls
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Inspect</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.tasks.map((t) => (
                  <TableRow key={t.taskId}>
                    <TableCell className="max-w-72">
                      <div className="truncate font-mono text-xs font-medium">
                        {t.taskId}
                      </div>
                      {t.prompt && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {t.prompt}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Dumbbell
                        tools={t.tools.rate.rate}
                        baseline={t.baseline?.rate.rate ?? null}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(t.tools.rate.rate)}{" "}
                      <span className="text-xs text-muted-foreground">
                        {t.tools.rate.passes}/{t.tools.rate.n}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {t.baseline ? pct(t.baseline.rate.rate) : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Lift value={t.lift?.delta} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {t.tools.meanToolCalls.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      <TrialSheet
                        taskId={t.taskId}
                        prompt={t.prompt}
                        trials={forClient(
                          r.trials.filter((x) => x.taskId === t.taskId),
                        )}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ToolCoverageCard
          fingerprint={r.toolSurface.fingerprint}
          total={r.toolSurface.count}
          approxTokens={r.toolSurface.approxTokens}
          used={toolSurface.used}
          neverCalled={toolSurface.neverCalled}
        />
      </div>
    </>
  );
}
