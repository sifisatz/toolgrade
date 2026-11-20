import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ConfusionPair } from "@/lib/tool-confusion";

interface ToolConfusionCardProps {
  pairs: ConfusionPair[];
}

export function ToolConfusionCard({ pairs }: ToolConfusionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool confusion</CardTitle>
        <CardDescription>
          Tasks where the expected tool wasn&apos;t called, and what the model
          called instead
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {pairs.map((p) => (
            <li
              key={`${p.taskId}:${p.expectedTool}:${p.calledInstead}`}
              className="flex flex-wrap items-center gap-1.5 text-sm"
            >
              <span className="truncate font-mono text-xs text-muted-foreground">
                {p.taskId}
              </span>
              <span className="text-muted-foreground">expected</span>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {p.expectedTool}
              </code>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">called</span>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {p.calledInstead}
              </code>
              <span className="text-xs tabular-nums text-muted-foreground">
                ({p.count} trial{p.count === 1 ? "" : "s"})
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
