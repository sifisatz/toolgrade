import {
  GitBranch,
  GitCommitHorizontal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import Link from "next/link";
import { DemoBadge, GateBadge, Lift } from "@/components/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunSummary } from "@/lib/data";
import { dateTime, pct, shortSha, usd } from "@/lib/format";

export function RunsTable({
  runs,
  base,
}: {
  runs: RunSummary[];
  base: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Change</TableHead>
          <TableHead className="text-right">Pass rate</TableHead>
          <TableHead className="hidden text-right md:table-cell">
            95% CI
          </TableHead>
          <TableHead className="text-right">Lift</TableHead>
          <TableHead className="hidden sm:table-cell">
            <span className="sr-only">Rating</span>
          </TableHead>
          <TableHead>Gate</TableHead>
          <TableHead className="hidden lg:table-cell">Model</TableHead>
          <TableHead className="hidden text-right md:table-cell">
            Cost
          </TableHead>
          <TableHead className="hidden text-right sm:table-cell">
            When
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id} className="relative">
            <TableCell className="max-w-80">
              <Link
                href={`${base}/runs/${r.id}`}
                className="after:absolute after:inset-0"
              >
                <div className="truncate font-medium">
                  {r.commitMessage ?? "Run"}
                </div>
              </Link>
              <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-mono">
                  <GitCommitHorizontal className="size-3.5" aria-hidden />
                  {shortSha(r.commit)}
                </span>
                {r.branch && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <GitBranch className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{r.branch}</span>
                  </span>
                )}
                {r.source === "demo" && <DemoBadge />}
              </div>
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {pct(r.passRate)}
            </TableCell>
            <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
              {pct(r.passLow)}-{pct(r.passHigh)}
            </TableCell>
            <TableCell className="text-right">
              <Lift value={r.lift} />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              {r.annotationRating === 1 && (
                <ThumbsUp
                  className="size-4 text-status-good"
                  aria-label="Good"
                  style={{ fill: "var(--status-good)" }}
                />
              )}
              {r.annotationRating === -1 && (
                <ThumbsDown
                  className="size-4 text-destructive"
                  aria-label="Bad"
                  style={{ fill: "var(--destructive)" }}
                />
              )}
            </TableCell>
            <TableCell>
              <GateBadge passed={r.gatePassed} />
            </TableCell>
            <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
              {r.agentModel}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">
              {usd(r.totalCostUsd)}
            </TableCell>
            <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
              {dateTime(r.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
