import { Fingerprint } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ToolUsage } from "@/lib/tool-surface";

interface ToolCoverageCardProps {
  fingerprint?: string | null;
  total: number;
  approxTokens: number;
  used: ToolUsage[];
  neverCalled: string[];
}

export function ToolCoverageCard({
  fingerprint,
  total,
  approxTokens,
  used,
  neverCalled,
}: ToolCoverageCardProps) {
  const usedCount = used.length;
  const coveragePct = total > 0 ? Math.round((usedCount / total) * 100) : 0;
  const usedTokens =
    total > 0 ? Math.round(approxTokens * (usedCount / total)) : 0;
  const savingsPct = 100 - coveragePct;

  const maxCalls =
    used.length > 0 ? Math.max(...used.map((t) => t.timesCalled)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Tool surface
          {fingerprint && (
            <span
              className="font-mono text-xs font-normal text-muted-foreground"
              title="A hash of every tool's name, description and schema - changes whenever any of those do, or a tool is added/removed."
            >
              <Fingerprint className="mr-1 inline size-3" aria-hidden />
              {fingerprint}
            </span>
          )}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>
            {usedCount} of {total} tool{total === 1 ? "" : "s"} used (
            {coveragePct}% coverage) — ~{usedTokens} of ~{approxTokens} schema
            tokens per turn
          </span>
          {coveragePct < 80 && savingsPct > 0 && (
            <Badge
              variant="outline"
              className="border-status-good/40 bg-status-good/10 text-status-good"
            >
              ~{savingsPct}% token savings potential
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Coverage progress bar */}
        <div className="space-y-1">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-status-good transition-all"
              style={{ width: `${coveragePct}%` }}
            />
          </div>
          {neverCalled.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {neverCalled.length} tool{neverCalled.length === 1 ? "" : "s"}{" "}
              never called
            </p>
          )}
        </div>

        {/* Two-column layout: used tools bars + never called */}
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Used tools with bar chart */}
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Called this run
            </div>
            {used.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tool calls recorded.
              </p>
            ) : (
              <ul className="space-y-2">
                {used.map((t) => {
                  const barPct =
                    maxCalls > 0
                      ? Math.max(
                          4,
                          Math.round((t.timesCalled / maxCalls) * 100),
                        )
                      : 4;
                  return (
                    <li key={t.name} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs">
                          {t.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-xs text-muted-foreground">
                          {t.errors > 0 && (
                            <Badge
                              variant="destructive"
                              className="text-[10px]"
                            >
                              {t.errors}e
                            </Badge>
                          )}
                          {t.successRate !== null && (
                            <Badge
                              variant="outline"
                              className={
                                t.successRate >= 0.75
                                  ? "border-status-good/40 bg-status-good/10 text-[10px] text-status-good"
                                  : t.successRate >= 0.5
                                    ? "border-status-warning/40 bg-status-warning/10 text-[10px] text-status-warning"
                                    : "border-status-critical/40 bg-status-critical/10 text-[10px] text-status-critical"
                              }
                            >
                              {Math.round(t.successRate * 100)}% win
                            </Badge>
                          )}
                          {t.timesCalled}x
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-chart-1 transition-all"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Never-called tools */}
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Never called
            </div>
            {neverCalled.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every exposed tool was called at least once.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {neverCalled.map((name) => (
                  <li key={name} className="flex items-center gap-2 opacity-50">
                    <span className="truncate font-mono text-xs">{name}</span>
                    <Badge
                      variant="outline"
                      className="shrink-0 text-[10px] font-normal"
                    >
                      unused
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
