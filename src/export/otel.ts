import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { ToolCallRecord } from "../agent.js";
import type { RunReport, TrialResult } from "../runner.js";

const MAX_TOOL_ARGS_CHARS = 2000;

export type AttributeValue = string | number | boolean;

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "INTERNAL";
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, AttributeValue>;
  events?: Array<{ name: string; timeUnixNano: string; attributes: Record<string, AttributeValue> }>;
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** span/trace ids use OTel's real byte lengths: 8 bytes (16 hex chars) for a span, 16 bytes (32 hex chars) for a trace. */
const newSpanId = () => hex(8);
const newTraceId = () => hex(16);

function toNanos(ms: number): bigint {
  return BigInt(Math.round(ms)) * 1_000_000n;
}

/**
 * Converts a ToolGrade run report into OTel GenAI spans: one root span per task spanning all its
 * trials, one child span per trial, and one `gen_ai.tool.execution` event per tool call within a
 * trial. There is no real wall-clock timestamp per trial in a `RunReport` (only durations), so
 * timestamps are synthesized by laying trials out sequentially starting at `report.startedAt` -
 * good enough to see cost/latency/tool-call structure in a trace viewer, not a replay of real time.
 */
export function reportToOtelSpans(report: RunReport): OtelSpan[] {
  const traceId = newTraceId();
  const spans: OtelSpan[] = [];
  let cursorNs = toNanos(new Date(report.startedAt).getTime());

  for (const task of report.tasks) {
    const trials = report.trials.filter((t) => t.taskId === task.taskId);
    if (trials.length === 0) continue;

    const taskSpanId = newSpanId();
    const taskStartNs = cursorNs;
    let taskToolCalls = 0;

    const childSpans: OtelSpan[] = [];
    for (const trial of trials) {
      const durationNs = toNanos(trial.trajectory?.durationMs ?? 1);
      const trialStartNs = cursorNs;
      const trialEndNs = trialStartNs + durationNs;
      cursorNs = trialEndNs;

      const toolCalls = trial.trajectory?.toolCalls ?? [];
      taskToolCalls += toolCalls.length;

      const events = toolCalls.length > 0 ? buildToolCallEvents(toolCalls, trialStartNs, durationNs) : undefined;

      childSpans.push({
        traceId,
        spanId: newSpanId(),
        parentSpanId: taskSpanId,
        name: `task.${task.taskId}.trial.${trial.trial}`,
        kind: "INTERNAL",
        startTimeUnixNano: trialStartNs.toString(),
        endTimeUnixNano: trialEndNs.toString(),
        attributes: trialAttributes(report, trial),
        ...(events ? { events } : {}),
      });
    }

    spans.push({
      traceId,
      spanId: taskSpanId,
      name: `task.${task.taskId}`,
      kind: "INTERNAL",
      startTimeUnixNano: taskStartNs.toString(),
      endTimeUnixNano: cursorNs.toString(),
      attributes: {
        "gen_ai.request.model": report.agentModel,
        "toolgrade.task.id": task.taskId,
        "toolgrade.tool.calls": taskToolCalls,
      },
    });
    spans.push(...childSpans);
  }

  return spans;
}

function trialAttributes(report: RunReport, trial: TrialResult): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "gen_ai.request.model": report.agentModel,
    "gen_ai.usage.input_tokens": trial.usage.inputTokens,
    "gen_ai.usage.output_tokens": trial.usage.outputTokens,
    "toolgrade.task.id": trial.taskId,
    "toolgrade.arm": trial.arm,
    "toolgrade.trial.passed": trial.passed,
    "toolgrade.tool.calls": trial.trajectory?.toolCalls.length ?? 0,
  };
  if (trial.variantId) attrs["toolgrade.variant"] = trial.variantId;
  if (trial.error) attrs["toolgrade.trial.error"] = trial.error;
  return attrs;
}

function buildToolCallEvents(
  toolCalls: ToolCallRecord[],
  trialStartNs: bigint,
  trialDurationNs: bigint,
): Array<{ name: string; timeUnixNano: string; attributes: Record<string, AttributeValue> }> {
  // Lay tool calls out sequentially within the trial's window, in proportion to their own
  // recorded durations (falling back to an even split if none were recorded).
  const totalMs = toolCalls.reduce((s, c) => s + c.durationMs, 0);
  let offsetNs = 0n;
  return toolCalls.map((call, i) => {
    const shareNs = totalMs > 0 ? (trialDurationNs * BigInt(Math.round(call.durationMs))) / BigInt(Math.round(totalMs)) : trialDurationNs / BigInt(toolCalls.length || 1);
    offsetNs += shareNs;
    const atNs = trialStartNs + (offsetNs > trialDurationNs ? trialDurationNs : offsetNs);
    const args = JSON.stringify(call.input ?? {});
    return {
      name: "gen_ai.tool.execution",
      timeUnixNano: atNs.toString(),
      attributes: {
        "gen_ai.tool.name": call.name,
        "gen_ai.tool.call.arguments": args.length > MAX_TOOL_ARGS_CHARS ? args.slice(0, MAX_TOOL_ARGS_CHARS) : args,
        error: call.isError,
      },
    };
  });
}

// --- OTLP/HTTP JSON wire format -------------------------------------------------------------
//
// This is the actual OTLP JSON wire shape (opentelemetry-proto's JSON mapping), not a convenience
// shape: trace_id/span_id are hex strings (proto3 JSON mapping's documented special case for these
// two fields - ordinarily bytes are base64), span kind is the enum's string name, and attributes
// are arrays of {key, value: {stringValue|intValue|doubleValue|boolValue}} rather than a plain
// object. Any collector that ingests OTLP/HTTP JSON (Jaeger, Langfuse, Phoenix, the OTel Collector)
// expects exactly this shape.

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

function toAnyValue(v: AttributeValue): OtlpAnyValue {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v };
}

function toKeyValues(attrs: Record<string, AttributeValue>): OtlpKeyValue[] {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

function toOtlpSpan(span: OtelSpan) {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    // OTLP JSON encodes enum fields as integers, never the proto enum name string.
    // SPAN_KIND_INTERNAL = 1 (opentelemetry-proto trace.proto SpanKind).
    kind: 1,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: toKeyValues(span.attributes),
    ...(span.events
      ? {
          events: span.events.map((e) => ({
            name: e.name,
            timeUnixNano: e.timeUnixNano,
            attributes: toKeyValues(e.attributes),
          })),
        }
      : {}),
  };
}

/** Wraps `reportToOtelSpans` output in the OTLP/HTTP JSON export-request envelope and writes it to disk. */
export async function writeOtelExport(report: RunReport, outputPath: string): Promise<void> {
  const spans = reportToOtelSpans(report);
  const envelope = {
    resourceSpans: [
      {
        resource: {
          attributes: toKeyValues({ "service.name": "toolgrade" }),
        },
        scopeSpans: [
          {
            scope: { name: "toolgrade" },
            spans: spans.map(toOtlpSpan),
          },
        ],
      },
    ],
  };
  await writeFile(outputPath, JSON.stringify(envelope, null, 2));
}
