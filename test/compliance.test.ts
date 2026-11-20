import { describe, expect, it } from "vitest";
import { lintSpecCompliance } from "../src/lint.js";
import type { McpTool } from "../src/mcp.js";

const tool = (overrides: Partial<McpTool> & Pick<McpTool, "name">): McpTool => ({
  description: "A tool.",
  inputSchema: { type: "object", properties: {} },
  ...overrides,
});

describe("lintSpecCompliance", () => {
  it("is 100% compliant when description, param docs, and annotations are all present", () => {
    const { results, compliancePercent } = lintSpecCompliance([
      tool({
        name: "search_notes",
        description: "Searches notes by text and returns matching ids.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "query text" } } },
        annotations: { readOnlyHint: true },
      }),
    ]);
    expect(results).toEqual([{ toolName: "search_notes", compliant: true, missing: [] }]);
    expect(compliancePercent).toBe(100);
  });

  it("reports what is missing: description, undocumented params, annotations", () => {
    const { results, compliancePercent } = lintSpecCompliance([
      tool({ name: "bad_tool", description: "", inputSchema: { type: "object", properties: { q: { type: "string" }, r: { type: "string", description: "ok" } } } }),
    ]);
    const r = results[0]!;
    expect(r.compliant).toBe(false);
    expect(r.missing).toContain("description");
    expect(r.missing.some((m) => m.includes("1/2 documented"))).toBe(true);
    expect(r.missing).toContain("annotations");
    expect(compliancePercent).toBe(0);
  });

  it("computes compliancePercent across multiple tools", () => {
    const { compliancePercent } = lintSpecCompliance([
      tool({ name: "a", description: "Does a thing well.", annotations: { readOnlyHint: true } }),
      tool({ name: "b", description: "" }),
    ]);
    expect(compliancePercent).toBe(50);
  });
});
