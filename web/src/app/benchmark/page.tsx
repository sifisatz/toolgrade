import {
  ArrowRight,
  CircleAlert,
  FlaskConical,
  GitBranch,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { Dumbbell, DumbbellLegend } from "@/components/dumbbell";
import { MarketingNav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/sections";
import { Lift, SignificanceBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import data from "@/data/benchmark.json";
import { FINDINGS } from "@/data/benchmark-findings";
import { pct, signedPct } from "@/lib/format";
import { REPO_URL } from "@/lib/site";

export const metadata = {
  title: "MCP Server Benchmark",
  description:
    "Do widely used MCP servers make an agent better than no tools? Graded with outcome checks, a no-tool baseline and honest confidence intervals.",
};

type Entry = {
  server: string;
  package: string;
  version: string;
  model: string;
  provider: string;
  date: string;
  tools: number;
  schemaTokens: number;
  tasks: number;
  trialsPerTask: number;
  passRate: { rate: number; low: number; high: number };
  baseline: { rate: number; low: number; high: number } | null;
  lift: { delta: number; low: number; high: number } | null;
  significance: string | null;
  meanToolCalls: number;
  errors: number;
  controlPassed: number | null;
  perTask: Array<{
    id: string;
    tags: string[];
    tools: number;
    baseline: number | null;
    lift: number | null;
    meanToolCalls: number;
  }>;
};

const entries = (data as { generatedAt: string | null; entries: Entry[] })
  .entries;
const models = [...new Set(entries.map((e) => e.model))];

export default function BenchmarkPage() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <MarketingNav />
      <main>
        <section className="relative overflow-hidden border-b">
          <div
            className="bg-grid pointer-events-none absolute inset-0 -z-10"
            aria-hidden
          />
          <div
            className="hero-glow pointer-events-none absolute -top-40 left-1/2 -z-10 h-[30rem] w-[60rem] -translate-x-1/2"
            aria-hidden
          />
          <div className="mx-auto max-w-6xl px-6 pt-16 pb-14">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <FlaskConical className="size-3.5 text-chart-1" aria-hidden />{" "}
              Open benchmark v0 - {entries[0]?.date ?? "pending"}
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Do popular MCP servers make agents better?
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
              Every task runs with the server and with no tools, three times
              each, in a fresh sandbox. A trial passes only if the answer - or
              the server&apos;s actual state afterwards - is right.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                size="lg"
                className="shine h-11 px-5"
                render={<Link href="#leaderboard" />}
              >
                See the results <ArrowRight />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-5"
                render={<Link href={`${REPO_URL}/tree/main/benchmark`} />}
              >
                <GitBranch /> Suites and raw reports
              </Button>
            </div>
          </div>
        </section>

        <section
          id="leaderboard"
          className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Leaderboard
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Model: {models.join(", ") || "-"}. Sorted by lift over the
                no-tool baseline. Intervals are 95%, with tasks as the sample.
              </p>
            </div>
            <DumbbellLegend />
          </div>

          {entries.length === 0 ? (
            <p className="mt-8 rounded-xl border p-6 text-sm text-muted-foreground">
              Results are being generated.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-2xl border">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Server</th>
                    <th className="px-4 py-3 font-medium">
                      No tools to with tools
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      With tools
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      No tools
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Lift (95% CI)
                    </th>
                    <th className="px-4 py-3 font-medium">Verdict</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Tools / schema
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr
                      key={`${e.server}-${e.model}`}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 items-center justify-center rounded-md border text-xs font-semibold">
                            {i + 1}
                          </span>
                          <a
                            href={`#${e.server}`}
                            className="font-medium hover:underline"
                          >
                            {e.server}
                          </a>
                        </div>
                        <div className="mt-0.5 pl-8 font-mono text-xs text-muted-foreground">
                          {e.package.replace("@modelcontextprotocol/", "")}@
                          {e.version}
                        </div>
                      </td>
                      <td className="w-56 px-4 py-4">
                        <Dumbbell
                          tools={e.passRate.rate}
                          baseline={e.baseline?.rate ?? null}
                        />
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">
                        <div className="font-medium">
                          {pct(e.passRate.rate)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pct(e.passRate.low)}-{pct(e.passRate.high)}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-muted-foreground tabular-nums">
                        {e.baseline ? pct(e.baseline.rate) : "-"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="font-medium">
                          <Lift value={e.lift?.delta} />
                        </div>
                        {e.lift && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {signedPct(e.lift.low)}..{signedPct(e.lift.high)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <SignificanceBadge value={e.significance} />
                      </td>
                      <td className="px-4 py-4 text-right text-muted-foreground tabular-nums">
                        {e.tools} / ~{e.schemaTokens.toLocaleString("en-US")}{" "}
                        tok
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {entries.length > 0 && (
          <section className="border-t bg-muted/30">
            <div className="mx-auto grid max-w-6xl gap-4 px-6 py-16 lg:grid-cols-3">
              {entries.map((e) => (
                <div
                  key={`${e.server}-${e.model}-detail`}
                  id={e.server}
                  className="reveal scroll-mt-20 rounded-2xl border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{e.server}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {e.model} - {e.tasks} tasks x {e.trialsPerTask} trials x
                        2 arms
                      </div>
                    </div>
                    <SignificanceBadge value={e.significance} />
                  </div>
                  <ul className="mt-4 space-y-2.5">
                    {e.perTask.map((t) => (
                      <li
                        key={t.id}
                        className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-xs"
                      >
                        <span
                          className="truncate font-mono text-muted-foreground"
                          title={t.id}
                        >
                          {t.id}
                        </span>
                        <Dumbbell tools={t.tools} baseline={t.baseline} />
                        <span className="text-right tabular-nums">
                          {pct(t.tools)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                    Control task with tools available:{" "}
                    {e.controlPassed === null ? "-" : pct(e.controlPassed)}
                    {e.errors > 0 && ` - ${e.errors} trial(s) errored`}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {FINDINGS.length > 0 && (
          <section
            id="findings"
            className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16"
          >
            <h2 className="text-2xl font-semibold tracking-tight">
              What failed, and why
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Read from the trial trajectories - the part a pass rate alone
              cannot tell you, and the part most useful to server authors.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {FINDINGS.map((f) => (
                <article
                  key={`${f.server}-${f.task}`}
                  className="reveal flex flex-col rounded-2xl border bg-card p-5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {f.server} / {f.task}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-status-critical/30 bg-status-critical/10 px-2 py-0.5 font-medium">
                      <CircleAlert
                        className="size-3 text-status-critical"
                        aria-hidden
                      />{" "}
                      {f.score}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {f.observed}
                  </p>
                  <p className="mt-auto border-t pt-3 text-sm">
                    <span className="font-medium">For server authors: </span>
                    <span className="text-muted-foreground">{f.lesson}</span>
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Method</h2>
              <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">
                    Two arms, same outcomes.
                  </span>{" "}
                  Each task runs with the server and with no tools. Both arms
                  are graded only on the answer or the resulting state, never on
                  which tool was called.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Fresh sandbox per trial.
                  </span>{" "}
                  A private copy of the suite&apos;s files or knowledge graph;
                  nothing leaks between trials.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Tested checks.
                  </span>{" "}
                  Every check is verified against the pinned server: a reference
                  solution must pass and the untouched start state must fail.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Honest intervals.
                  </span>{" "}
                  Tasks are the sample (Wilson for pass rates, Newcombe for
                  lift), so small suites show wide intervals instead of false
                  confidence.
                </li>
              </ul>
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <TriangleAlert
                  className="size-5 text-status-warning"
                  aria-hidden
                />{" "}
                Read before quoting
              </h2>
              <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
                <li>
                  A score belongs to server + model + task set, not to the
                  server alone. v0 uses one small open-weights model run on a
                  laptop; stronger models score higher.
                </li>
                <li>
                  5-6 tasks per server cannot cover a whole tool surface. New
                  tasks are welcome as pull requests.
                </li>
                <li>
                  sequential-thinking has no state to check; its tasks are
                  reasoning problems, so near-zero lift means it did not help on
                  these problems with this model.
                </li>
                <li>Servers that need accounts or API keys are not in v0.</li>
                <li>
                  The runner container&apos;s network is internal-only by
                  design, so servers that need a real external API (weather,
                  search, Wikipedia) are not in v0 either.
                </li>
                <li>
                  mcp-server-calculator&apos;s suite is written and validated
                  but has no published run yet - qwen3:8b&apos;s reasoning mode
                  spiralled into runaway chain-of-thought on these arithmetic
                  tasks, timing out even an extended request timeout.
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12">
            <h2 className="text-2xl font-semibold tracking-tight">
              Reproduce it
            </h2>
            <div className="mt-5 max-w-3xl">
              <CodeBlock
                label="terminal"
                code={`git clone ${REPO_URL} && cd toolgrade
pnpm install && pnpm build
ollama pull qwen3:8b            # free local model, or any OpenAI-compatible endpoint
benchmark/run.sh openai qwen3:8b
npx tsx benchmark/summarize.mts`}
              />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
