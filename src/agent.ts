import type Anthropic from "@anthropic-ai/sdk";
import type { McpSession, McpTool } from "./mcp.js";
import type { Effort, ModelProvider } from "./providers/types.js";

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  durationMs: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Trajectory extends Usage {
  /** Text of the last model turn only; earlier preambles ("let me search...") are not answers. */
  finalText: string;
  toolCalls: ToolCallRecord[];
  turns: number;
  stopReason: string;
  /** Set when the run did not end normally: max_turns, max_tokens, refusal, context exceeded, ... */
  incomplete?: string;
  durationMs: number;
}

export interface AgentOptions {
  provider: ModelProvider;
  model: string;
  prompt: string;
  system?: string;
  maxTurns: number;
  maxTokens: number;
  maxToolResultChars: number;
  effort?: Effort;
  /** Tools are exposed only when a session is given; the baseline arm passes none. */
  session?: McpSession;
  /**
   * Per-tool description overrides for A/B variant arms.
   * A null description suppresses (hides) that tool from the model entirely.
   * Only tools explicitly named here are affected; all others are passed unchanged.
   */
  toolOverrides?: Record<string, { description: string | null }>;
}

/** Thrown when a turn fails mid-run; carries the usage already spent so cost stays honest. */
export class AgentRunError extends Error {
  constructor(
    readonly cause: unknown,
    readonly usage: Usage,
    readonly turn: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

const NORMAL_STOPS = new Set(["end_turn", "stop_sequence"]);

export function toAnthropicTools(tools: McpTool[]): Anthropic.Tool[] {
  return tools.map((t) => {
    // `$schema` is emitted by MCP SDKs but means nothing to the model; drop it.
    const { $schema: _ignored, ...schema } = t.inputSchema;
    return {
      name: t.name,
      description: t.description ?? "",
      input_schema: { type: "object", ...schema } as Anthropic.Tool.InputSchema,
    };
  });
}

export function capText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated by toolgrade: ${text.length - max} more chars]` : text;
}

export async function runAgent(opts: AgentOptions): Promise<Trajectory> {
  const started = Date.now();
  const baseTools = opts.session ? toAnthropicTools(opts.session.tools) : [];
  // Apply description overrides and suppression for variant arms.
  const tools = opts.toolOverrides
    ? baseTools
        .filter((t) => opts.toolOverrides![t.name]?.description !== null)
        .map((t) => {
          const ov = opts.toolOverrides![t.name];
          if (!ov || ov.description === undefined) return t;
          return { ...t, description: ov.description ?? t.description };
        })
    : baseTools;
  const known = new Set(tools.map((t) => t.name));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  const toolCalls: ToolCallRecord[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let finalText = "";
  let stopReason = "unknown";
  const done = (turns: number, incomplete?: string): Trajectory => ({
    finalText,
    toolCalls,
    turns,
    stopReason,
    ...(incomplete ? { incomplete } : {}),
    ...usage,
    durationMs: Date.now() - started,
  });

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    let res;
    try {
      res = await opts.provider.turn({
        model: opts.model,
        system: opts.system,
        messages,
        tools,
        maxTokens: opts.maxTokens,
        effort: opts.effort,
      });
    } catch (err) {
      throw new AgentRunError(err, { ...usage }, turn);
    }
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    stopReason = res.stopReason;
    finalText = res.text;
    messages.push({ role: "assistant", content: res.content });

    if (res.stopReason === "pause_turn") continue;
    if (res.stopReason === "tool_use" && res.toolUses.length > 0) {
      // Sequential on purpose: servers under test are rarely safe for concurrent mutation.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of res.toolUses) {
        const t0 = Date.now();
        const outcome =
          opts.session && known.has(use.name)
            ? await opts.session.callTool(use.name, use.input)
            : { text: `Unknown tool: ${use.name}`, isError: true };
        toolCalls.push({ name: use.name, input: use.input, output: outcome.text, isError: outcome.isError, durationMs: Date.now() - t0 });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: capText(outcome.text, opts.maxToolResultChars),
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    return done(turn, NORMAL_STOPS.has(res.stopReason) ? undefined : res.stopReason);
  }
  return done(opts.maxTurns, "max_turns");
}
