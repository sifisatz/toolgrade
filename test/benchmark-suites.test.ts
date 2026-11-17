// Validates the public benchmark's checks against the real, pinned servers: for every task, a
// reference solution must pass and the untouched starting state (what a no-tool agent leaves
// behind) must fail. A check that cannot tell the two apart would make the leaderboard lie.
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Trajectory } from "../src/agent.js";
import { evaluateAll } from "../src/assertions.js";
import { loadSuite, type Suite } from "../src/config.js";
import { openSession } from "../src/mcp.js";

const ROOT = join(import.meta.dirname, "..", "benchmark");
const onPath = (bin: string) => (process.env.PATH ?? "").split(delimiter).some((dir) => existsSync(join(dir, bin)));
const npmInstalled = (pkg: string) => existsSync(join(ROOT, "node_modules", pkg));
// The npm servers install with `pnpm install` in benchmark/; the rest exist only in the runner image.
const AVAILABLE: Record<string, () => boolean> = {
  everything: () => npmInstalled("@modelcontextprotocol/server-everything"),
  filesystem: () => npmInstalled("@modelcontextprotocol/server-filesystem"),
  memory: () => npmInstalled("@modelcontextprotocol/server-memory"),
  "sequential-thinking": () => npmInstalled("@modelcontextprotocol/server-sequential-thinking"),
  playwright: () => npmInstalled("@playwright/mcp"),
  git: () => onPath("mcp-server-git") && existsSync(join(ROOT, "fixtures", "git", "repo")),
  sqlite: () => onPath("toolbox") && existsSync(join(ROOT, "fixtures", "sqlite", "shop.db")),
  time: () => onPath("mcp-server-time"),
  calculator: () => onPath("mcp-server-calculator"),
  excel: () => onPath("excel-mcp-server") && existsSync(join(ROOT, "fixtures", "excel", "shop.xlsx")),
  pandoc: () => onPath("mcp-pandoc") && onPath("pandoc"),
};

type Step = [tool: string, args: Record<string, unknown>];
type Reference = { answer?: string; steps?: Step[] };

const answerOnly = (finalText: string): Trajectory => ({ finalText, toolCalls: [], turns: 1, stopReason: "end_turn", inputTokens: 0, outputTokens: 0, durationMs: 0 });

async function verdict(suite: Suite, taskId: string, ref: Reference | "untouched") {
  const task = suite.tasks.find((t) => t.id === taskId)!;
  const session = await openSession(suite.server);
  try {
    const fill = (v: unknown): unknown =>
      typeof v === "string" ? v.replaceAll("${TRIAL_DIR}", session.trialDir ?? "") : Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
    if (ref !== "untouched") {
      for (const [tool, args] of ref.steps ?? []) {
        const out = await session.callTool(tool, fill(args) as Record<string, unknown>);
        expect(out.isError, `${taskId}: ${tool} failed: ${out.text}`).toBe(false);
      }
    }
    const text = ref === "untouched" ? "I don't have access to that information." : (ref.answer ?? "Done.");
    const results = await evaluateAll(task.assert, { prompt: task.prompt, trajectory: answerOnly(text), session });
    return results.every((r) => r.passed);
  } finally {
    await session.close();
  }
}

const REFERENCES: Record<string, Record<string, Reference>> = {
  everything: {
    "hidden-config": { answer: "The FOO_BENCHMARK environment variable is marker-9f2." },
    "masked-secret": { answer: "The API_TOKEN environment variable is <redacted>." },
    "chicago-weather": { answer: "Chicago: temperature 36 C, conditions light rain / drizzle, humidity 82%." },
    "resource-seven": { answer: "Resource 7: this is a plaintext resource created a moment ago." },
    "exact-sum": { answer: "67839" },
    "no-tool-needed": { answer: "391" },
  },
  filesystem: {
    "find-decision": { answer: "They decided to migrate billing to the v2 API by December." },
    "top-region": { answer: "The US had the highest revenue: 205k EUR." },
    "edit-config": { steps: [["edit_file", { path: "${TRIAL_DIR}/src/config.json", edits: [{ oldText: '"debug": true', newText: '"debug": false' }] }]] },
    "append-todo": { steps: [["append_file", { path: "${TRIAL_DIR}/notes/todo.txt", content: "- rotate API keys\n" }]] },
    "create-changelog": {
      steps: [
        ["create_directory", { path: "${TRIAL_DIR}/docs" }],
        ["write_file", { path: "${TRIAL_DIR}/docs/CHANGELOG.md", content: "# 0.2.0\n\n- Add order search\n" }],
      ],
    },
    "rename-report": { steps: [["move_file", { source: "${TRIAL_DIR}/reports/q3.csv", destination: "${TRIAL_DIR}/reports/2026-q3.csv" }]] },
    "no-tool-needed": { answer: "391" },
  },
  memory: {
    "recall-lead": { answer: "Dana Reyes leads it; it ships in December." },
    "remember-person": { steps: [["create_entities", { entities: [{ name: "Priya Nair", entityType: "person", observations: ["Product designer", "Joined the team in November"] }] }]] },
    "relate-people": { steps: [["create_relations", { relations: [{ from: "Sam Okafor", to: "Dana Reyes", relationType: "reports to" }] }]] },
    "update-fact": { steps: [["add_observations", { observations: [{ entityName: "Billing v2", contents: ["Now ships in January"] }] }]] },
    "forget-person": { steps: [["delete_entities", { entityNames: ["Sam Okafor"] }]] },
    "no-tool-needed": { answer: "391" },
  },
  "sequential-thinking": {
    "bat-and-ball": { answer: "The ball costs 5 cents." },
    "weekday-offset": { answer: "It will be Wednesday." },
    "meeting-rooms": { answer: "2" },
    ordering: { answer: "Dan is oldest, so Alice is the second oldest." },
    "discount-chain": { answer: "The final price is 162 euros." },
    "no-tool-needed": { answer: "391" },
  },
  time: {
    "tokyo-to-kathmandu": { answer: "It is 05:45 in Kathmandu." },
    "dubai-to-honolulu": { answer: "It is 00:30 in Honolulu." },
    "phoenix-to-shanghai": { answer: "It is 23:15 in Shanghai." },
    "brisbane-to-kolkata": { answer: "It is 18:30 in Kolkata." },
    "kathmandu-vs-kolkata": { answer: "Kathmandu is 15 minutes ahead of Kolkata." },
    "no-tool-needed": { answer: "391" },
  },
  git: {
    "last-commit": { answer: "Linus made it; it fixed an off-by-one in pagination." },
    "uncommitted-files": { answer: "src/app.py is modified and notes.txt is untracked." },
    "feature-branch": { answer: "It adds case-insensitive fuzzy search." },
    "commit-change": {
      steps: [
        ["git_add", { repo_path: "${TRIAL_DIR}", files: ["src/app.py"] }],
        ["git_commit", { repo_path: "${TRIAL_DIR}", message: "Return no results for an empty query" }],
      ],
    },
    "create-branch": { steps: [["git_create_branch", { repo_path: "${TRIAL_DIR}", branch_name: "release/1.2", base_branch: "main" }]] },
    "no-tool-needed": { answer: "391" },
  },
  sqlite: {
    "top-customer": { answer: "Maria Papadopoulou." },
    "pending-value": { answer: "297 EUR." },
    "out-of-stock": { answer: "City Sneaker." },
    "ship-order": { steps: [["execute_sql", { sql: "UPDATE orders SET status = 'shipped' WHERE id = 3" }]] },
    "add-customer": { steps: [["execute_sql", { sql: "INSERT INTO customers (name, country) VALUES ('Sofia Andersson', 'SE')" }]] },
    "no-tool-needed": { answer: "391" },
  },
  calculator: {
    "order-of-operations": { answer: "The result is 1345." },
    "perfect-square-root": { answer: "The result is 124." },
    "factorial-division": { answer: "The result is 3628.8." },
    "floor-div-and-mod": { answer: "The result is 302." },
    "no-tool-needed": { answer: "391" },
  },
  excel: {
    "top-customer": { answer: "Nikos Pappas has the highest order, 300." },
    "pending-total": { answer: "The total of pending orders is 372." },
    "mark-shipped": { steps: [["write_range", { path: "shop.xlsx", sheet: "Orders", at: "D3", rows: [["shipped"]] }]] },
    "add-order": { steps: [["write_range", { path: "shop.xlsx", sheet: "Orders", at: "A7", rows: [[6, "Dimitris Georgiou", 150, "pending"]] }]] },
    "no-tool-needed": { answer: "391" },
  },
  pandoc: {
    "markdown-to-html": { answer: '<h1 id="hello">Hello</h1>\n<p>This is <strong>bold</strong> text.</p>' },
    "html-to-markdown": { answer: "## Section\n\nSome *italic* text." },
    "list-conversion": { answer: "<ul>\n<li>apples</li>\n<li>bananas</li>\n<li>cherries</li>\n</ul>" },
    "markdown-to-latex": { answer: "\\section{Title}\n\nBody text here." },
    "no-tool-needed": { answer: "391" },
  },
  playwright: {
    "product-price": { answer: "The Hiking Boot costs 149.00 EUR." },
    "cheap-in-stock": { answer: "2 products." },
    "shipping-cost": { answer: "7.50 EUR." },
    "place-order": {
      answer: "The page shows reference NW-1116.",
      steps: [
        ["browser_navigate", { url: "file://${TRIAL_DIR}/order.html" }],
        [
          "browser_evaluate",
          {
            function:
              "() => { const f = document.getElementById('order'); f.product.value = 'Trail Runner'; f.quantity.value = '2'; f.size.value = '42'; f.name.value = 'Nikos Pappas'; f.requestSubmit(); return document.getElementById('result').textContent; }",
          },
        ],
      ],
    },
    "newsletter-error": { answer: "It shows code E-EMAIL-01." },
    "no-tool-needed": { answer: "391" },
  },
};

describe("public benchmark suites", () => {
  for (const [name, refs] of Object.entries(REFERENCES)) {
    describe.skipIf(!AVAILABLE[name]?.())(name, async () => {
      const suite = await loadSuite(join(ROOT, "suites", `${name}.yaml`));

      it("has a reference solution for every task", () => {
        expect(suite.tasks.map((t) => t.id).sort()).toEqual(Object.keys(refs).sort());
      });

      for (const [taskId, ref] of Object.entries(refs)) {
        it(`${taskId}: the reference solution passes`, async () => {
          expect(await verdict(suite, taskId, ref)).toBe(true);
        });
        // The control task is solvable without tools by design.
        if (taskId !== "no-tool-needed") {
          it(`${taskId}: the untouched start state fails`, async () => {
            expect(await verdict(suite, taskId, "untouched")).toBe(false);
          });
        }
      }
    });
  }
});
