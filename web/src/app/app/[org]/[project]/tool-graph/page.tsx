import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
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
import { getProject } from "@/lib/data";
import { requireUser } from "@/lib/session";
import type {
  ProjectToolGraph,
  TagOptimization,
  TaskToolProfile,
} from "@/lib/tool-graph";
import { buildProjectToolGraph } from "@/lib/tool-graph";

export const metadata = { title: "Tool Graph" };

export default function ToolGraphPage({
  params,
}: PageProps<"/app/[org]/[project]/tool-graph">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ToolGraph params={params} />
    </Suspense>
  );
}

async function ToolGraph({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const user = await requireUser();
  const found = await getProject(user.id, orgSlug, projectSlug);
  if (!found) notFound();
  const { project, org } = found;
  const base = `/app/${org.slug}/${project.slug}`;
  const graph = await buildProjectToolGraph(project.id);

  if (graph.runsAnalyzed === 0) {
    return (
      <>
        <PageHeader
          crumbs={[
            { label: org.name, href: `/app/${org.slug}` },
            { label: project.name, href: base },
            { label: "Tool graph" },
          ]}
          title="Tool graph"
          description="Cross-run tool usage analysis — which tools are used for which tasks, and how to reduce token overhead."
        />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No runs yet — run a benchmark to see tool graph data.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: org.name, href: `/app/${org.slug}` },
          { label: project.name, href: base },
          { label: "Tool graph" },
        ]}
        title="Tool graph"
        description="Cross-run tool usage analysis — which tools are used for which tasks, and how to reduce token overhead."
      />

      {/* Section 1: Summary row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Runs analyzed" value={graph.runsAnalyzed} />
        <StatTile
          label="Tools in surface"
          value={graph.allSurfaceTools.length}
        />
        <StatTile
          label="Tools actually used"
          value={graph.usedToolsUnion.length}
        />
        <StatTile
          label="Max token saving"
          value={`${graph.overallTokenSavingPct}%`}
        />
      </div>

      {/* Section 2: L3 Optimization Opportunities */}
      <OptimizationCard graph={graph} />

      {/* Section 3: L2 Task × Tool Matrix */}
      <TaskToolMatrix graph={graph} />

      {/* Section 4: L2 Tool Co-occurrence */}
      <CoOccurrenceCard graph={graph} />
    </>
  );
}

function OptimizationCard({ graph }: { graph: ProjectToolGraph }) {
  const { tagOptimizations } = graph;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Optimization Opportunities</CardTitle>
        <CardDescription>
          Minimal tool sets per task tag — estimated token savings based on
          observed tool usage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tagOptimizations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All tools are used across all task types — no optimization potential
            found.
          </p>
        ) : (
          <div className="space-y-3">
            {tagOptimizations.map((opt) => (
              <TagOptRow key={opt.tag} opt={opt} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TagOptRow({ opt }: { opt: TagOptimization }) {
  const savingVariant =
    opt.tokenSavingPct >= 50
      ? "default"
      : opt.tokenSavingPct >= 20
        ? "secondary"
        : "outline";

  const barPct =
    opt.fullSurfaceTools > 0
      ? Math.round((opt.minimalTools.length / opt.fullSurfaceTools) * 100)
      : 100;

  return (
    <details className="group rounded-md border p-3">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
        <Badge variant="outline" className="shrink-0 font-mono text-xs">
          {opt.tag}
        </Badge>
        <span className="text-muted-foreground">{opt.taskCount} tasks</span>
        <span className="hidden text-muted-foreground sm:inline">
          {opt.minimalTools.length} of {opt.fullSurfaceTools} tools needed
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* Simple bar */}
          <div
            className="hidden h-2 w-24 overflow-hidden rounded-full bg-muted sm:block"
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <Badge variant={savingVariant} className="shrink-0 text-xs">
            {opt.tokenSavingPct}% token savings
          </Badge>
        </div>
      </summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {opt.minimalTools.map((tool) => (
          <Badge key={tool} variant="secondary" className="font-mono text-xs">
            {tool}
          </Badge>
        ))}
      </div>
    </details>
  );
}

const TOP_TOOLS = 15;

function TaskToolMatrix({ graph }: { graph: ProjectToolGraph }) {
  const { taskProfiles, usedToolsUnion } = graph;

  if (taskProfiles.length === 0) return null;

  // Count total calls per tool across all tasks for column ordering
  const toolTotalCalls: Record<string, number> = {};
  for (const profile of taskProfiles) {
    for (const [tool, count] of Object.entries(profile.callCountByTool)) {
      toolTotalCalls[tool] = (toolTotalCalls[tool] ?? 0) + count;
    }
  }

  const displayTools = usedToolsUnion
    .slice()
    .sort((a, b) => (toolTotalCalls[b] ?? 0) - (toolTotalCalls[a] ?? 0))
    .slice(0, TOP_TOOLS);

  const sortedProfiles = taskProfiles
    .slice()
    .sort((a, b) => b.totalCalls - a.totalCalls);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Task × Tool Usage Matrix</CardTitle>
        <CardDescription>
          Which tools each task type uses, aggregated across all runs.
          {usedToolsUnion.length > TOP_TOOLS && (
            <> Showing top {TOP_TOOLS} tools by total usage.</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">Task</TableHead>
              {displayTools.map((tool) => (
                <TableHead key={tool} className="min-w-20 font-mono text-xs">
                  {tool}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedProfiles.map((profile) => (
              <TaskRow
                key={profile.taskId}
                profile={profile}
                displayTools={displayTools}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  profile,
  displayTools,
}: {
  profile: TaskToolProfile;
  displayTools: string[];
}) {
  return (
    <TableRow>
      <TableCell className="max-w-48">
        <div className="flex flex-wrap items-center gap-1">
          <span className="truncate font-mono text-xs">{profile.taskId}</span>
          {profile.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      </TableCell>
      {displayTools.map((tool) => {
        const count = profile.callCountByTool[tool];
        return (
          <TableCell key={tool} className="text-center">
            {count != null && count > 0 ? (
              <span className="rounded-sm bg-green-500/15 px-1.5 py-0.5 font-mono text-xs text-green-700 dark:text-green-400">
                {count}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/40">—</span>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function CoOccurrenceCard({ graph }: { graph: ProjectToolGraph }) {
  const qualifyingPairs = graph.coOccurrence
    .filter((p) => p.tasksTogether >= 2)
    .slice(0, 10);

  if (qualifyingPairs.length < 2) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Tool Co-occurrence</CardTitle>
        <CardDescription>
          Tools frequently used together — a tool pair with high co-occurrence
          is a natural bundle.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool A</TableHead>
              <TableHead>Tool B</TableHead>
              <TableHead className="text-right">Tasks together</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {qualifyingPairs.map((pair) => (
              <TableRow key={`${pair.toolA}|||${pair.toolB}`}>
                <TableCell className="font-mono text-xs">
                  {pair.toolA}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {pair.toolB}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pair.tasksTogether}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
