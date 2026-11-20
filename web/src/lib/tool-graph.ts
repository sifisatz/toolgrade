import "server-only";
import { desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import type { RunReport } from "toolgrade/core";
import { getDb } from "@/db/client";
import { runs } from "@/db/schema";

export interface TaskToolProfile {
  taskId: string;
  tags: string[];
  toolsUsed: string[]; // union across all runs for this task
  callCountByTool: Record<string, number>; // total calls across all runs
  totalCalls: number;
  runsObserved: number; // how many runs included this task
}

export interface ToolCoOccurrence {
  toolA: string;
  toolB: string;
  tasksTogether: number; // number of tasks that use both tools (across all runs)
}

export interface TagOptimization {
  tag: string;
  taskCount: number;
  fullSurfaceTools: number; // total tools in server
  fullSurfaceTokens: number; // approxTokens for all tools
  minimalTools: string[]; // tools actually needed for this tag
  minimalTokens: number; // estimated tokens for minimal set
  tokenSavingPct: number; // % savings
}

export interface ProjectToolGraph {
  projectId: string;
  runsAnalyzed: number;
  allSurfaceTools: string[]; // union of all tools ever seen
  taskProfiles: TaskToolProfile[];
  coOccurrence: ToolCoOccurrence[]; // top pairs, sorted by tasksTogether desc
  tagOptimizations: TagOptimization[];
  // derived convenience fields
  usedToolsUnion: string[]; // tools called in at least one task
  neverUsedTools: string[]; // tools in surface but never called in any task
  overallTokenSavingPct: number; // if you used only usedToolsUnion
}

export async function buildProjectToolGraph(
  projectId: string,
): Promise<ProjectToolGraph> {
  await connection();
  const db = await getDb();

  const rows = await db
    .select({ report: runs.report })
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.createdAt))
    .limit(20);

  if (rows.length === 0) {
    return {
      projectId,
      runsAnalyzed: 0,
      allSurfaceTools: [],
      taskProfiles: [],
      coOccurrence: [],
      tagOptimizations: [],
      usedToolsUnion: [],
      neverUsedTools: [],
      overallTokenSavingPct: 0,
    };
  }

  // --- Collect surface tools and token counts across runs ---
  const surfaceToolsSet = new Set<string>();
  let latestApproxTokens = 0;

  for (const { report } of rows) {
    for (const name of report.toolSurface.names) {
      surfaceToolsSet.add(name);
    }
    // Use the most recent run's token count as the reference
    if (latestApproxTokens === 0) {
      latestApproxTokens = report.toolSurface.approxTokens;
    }
  }

  const allSurfaceTools = [...surfaceToolsSet].sort();

  // --- Aggregate task profiles ---
  // taskId -> { tags, callCountByTool, runsObserved }
  const taskMap = new Map<
    string,
    {
      tags: string[];
      callCountByTool: Map<string, number>;
      runsObserved: number;
    }
  >();

  for (const { report } of rows) {
    const taskReport = report as RunReport;

    // Map taskId -> tags from TaskSummary
    const taskTagsMap = new Map<string, string[]>();
    for (const task of taskReport.tasks) {
      taskTagsMap.set(task.taskId, task.tags);
    }

    // Build per-task tool call counts from trials
    const taskToolCalls = new Map<string, Map<string, number>>();
    for (const trial of taskReport.trials) {
      if (!trial.trajectory) continue;
      const toolCallsForTask =
        taskToolCalls.get(trial.taskId) ?? new Map<string, number>();
      for (const call of trial.trajectory.toolCalls) {
        toolCallsForTask.set(
          call.name,
          (toolCallsForTask.get(call.name) ?? 0) + 1,
        );
      }
      taskToolCalls.set(trial.taskId, toolCallsForTask);
    }

    // Merge into taskMap
    for (const [taskId, toolCallMap] of taskToolCalls.entries()) {
      const existing = taskMap.get(taskId);
      const tags = taskTagsMap.get(taskId) ?? [];
      if (!existing) {
        taskMap.set(taskId, {
          tags,
          callCountByTool: new Map(toolCallMap),
          runsObserved: 1,
        });
      } else {
        // Merge tags (union)
        for (const tag of tags) {
          if (!existing.tags.includes(tag)) existing.tags.push(tag);
        }
        // Accumulate tool call counts
        for (const [tool, count] of toolCallMap.entries()) {
          existing.callCountByTool.set(
            tool,
            (existing.callCountByTool.get(tool) ?? 0) + count,
          );
        }
        existing.runsObserved++;
      }
    }
  }

  // Convert taskMap to TaskToolProfile[]
  const taskProfiles: TaskToolProfile[] = [];
  for (const [taskId, data] of taskMap.entries()) {
    const callCountByTool: Record<string, number> = {};
    for (const [tool, count] of data.callCountByTool.entries()) {
      callCountByTool[tool] = count;
    }
    const toolsUsed = [...data.callCountByTool.keys()];
    const totalCalls = toolsUsed.reduce(
      (sum, t) => sum + (callCountByTool[t] ?? 0),
      0,
    );
    taskProfiles.push({
      taskId,
      tags: data.tags,
      toolsUsed,
      callCountByTool,
      totalCalls,
      runsObserved: data.runsObserved,
    });
  }

  // --- Derive usedToolsUnion and neverUsedTools ---
  const usedSet = new Set<string>();
  for (const profile of taskProfiles) {
    for (const tool of profile.toolsUsed) {
      usedSet.add(tool);
    }
  }
  const usedToolsUnion = [...usedSet].sort();
  const neverUsedTools = allSurfaceTools.filter((t) => !usedSet.has(t));

  // --- Co-occurrence: count pairs of tools that appear in the same task ---
  const pairCounts = new Map<string, number>();
  for (const profile of taskProfiles) {
    const tools = profile.toolsUsed.slice().sort();
    for (let i = 0; i < tools.length; i++) {
      for (let j = i + 1; j < tools.length; j++) {
        const key = `${tools[i]}|||${tools[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const coOccurrence: ToolCoOccurrence[] = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [toolA, toolB] = key.split("|||") as [string, string];
      return { toolA, toolB, tasksTogether: count };
    })
    .sort((a, b) => b.tasksTogether - a.tasksTogether);

  // --- Tag optimizations ---
  // Collect all tags and which tools are used for each
  const tagToolsMap = new Map<string, Set<string>>();
  const tagTaskIds = new Map<string, Set<string>>();

  for (const profile of taskProfiles) {
    for (const tag of profile.tags) {
      const toolSet = tagToolsMap.get(tag) ?? new Set<string>();
      for (const tool of profile.toolsUsed) toolSet.add(tool);
      tagToolsMap.set(tag, toolSet);

      const taskSet = tagTaskIds.get(tag) ?? new Set<string>();
      taskSet.add(profile.taskId);
      tagTaskIds.set(tag, taskSet);
    }
  }

  const tagOptimizations: TagOptimization[] = [];
  for (const [tag, toolSet] of tagToolsMap.entries()) {
    const minimalTools = [...toolSet].sort();
    const fullSurfaceTools = allSurfaceTools.length;
    const fullSurfaceTokens = latestApproxTokens;
    const minimalTokens =
      fullSurfaceTools > 0
        ? Math.round(
            fullSurfaceTokens * (minimalTools.length / fullSurfaceTools),
          )
        : 0;
    const tokenSavingPct =
      fullSurfaceTokens > 0
        ? Math.round(
            ((fullSurfaceTokens - minimalTokens) / fullSurfaceTokens) * 100,
          )
        : 0;
    const taskCount = tagTaskIds.get(tag)?.size ?? 0;

    tagOptimizations.push({
      tag,
      taskCount,
      fullSurfaceTools,
      fullSurfaceTokens,
      minimalTools,
      minimalTokens,
      tokenSavingPct,
    });
  }

  tagOptimizations.sort((a, b) => b.tokenSavingPct - a.tokenSavingPct);

  // --- Overall token saving ---
  const overallTokenSavingPct =
    latestApproxTokens > 0 && allSurfaceTools.length > 0
      ? Math.round(
          ((allSurfaceTools.length - usedToolsUnion.length) /
            allSurfaceTools.length) *
            100,
        )
      : 0;

  return {
    projectId,
    runsAnalyzed: rows.length,
    allSurfaceTools,
    taskProfiles,
    coOccurrence,
    tagOptimizations,
    usedToolsUnion,
    neverUsedTools,
    overallTokenSavingPct,
  };
}
