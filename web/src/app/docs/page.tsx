import {
  BookOpen,
  Code2,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Rocket,
  Terminal,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Everything you need to add eval-first quality gates to your MCP server.",
};

const SECTIONS = [
  {
    eyebrow: "Start here",
    title: "Getting started",
    description:
      "Understand what ToolGrade does and run your first evaluation in 5 minutes.",
    icon: Rocket,
    links: [
      {
        href: "/docs/what-is-toolgrade",
        label: "What is ToolGrade?",
        desc: "Plain-language intro — no MCP background needed.",
      },
      {
        href: "/docs/quickstart",
        label: "5-minute quickstart",
        desc: "From zero to your first graded run.",
      },
    ],
  },
  {
    eyebrow: "Learn by doing",
    title: "Guides",
    description:
      "Step-by-step walkthroughs for real-world evaluation scenarios.",
    icon: BookOpen,
    links: [
      {
        href: "/docs/guides/writing-your-first-suite",
        label: "Writing your first suite",
        desc: "How to write tasks that actually catch regressions.",
      },
      {
        href: "/docs/guides/understanding-results",
        label: "Understanding results",
        desc: "What pass rate, baseline, lift, and gates mean.",
      },
      {
        href: "/docs/guides/ci-github-actions",
        label: "GitHub Actions CI",
        desc: "Block broken PRs before they reach main.",
      },
      {
        href: "/docs/guides/using-ollama-locally",
        label: "Using Ollama locally",
        desc: "Free local evals with open-source models.",
      },
    ],
  },
  {
    eyebrow: "Look things up",
    title: "Reference",
    description: "Complete specification for every command, flag, and option.",
    icon: Code2,
    links: [
      {
        href: "/docs/reference/cli",
        label: "CLI reference",
        desc: "All commands and flags with examples.",
      },
      {
        href: "/docs/reference/suite-yaml",
        label: "Suite YAML reference",
        desc: "Full toolgrade.yaml schema.",
      },
      {
        href: "/docs/reference/assertions",
        label: "Assertions",
        desc: "Every assertion type with examples.",
      },
      {
        href: "/docs/reference/api",
        label: "Platform API",
        desc: "REST API for custom integrations.",
      },
    ],
  },
  {
    eyebrow: "The web platform",
    title: "Dashboard",
    description: "Navigate the hosted platform for history, trends, and teams.",
    icon: LayoutDashboard,
    links: [
      {
        href: "/docs/dashboard/overview",
        label: "Dashboard overview",
        desc: "Navigating the web platform.",
      },
      {
        href: "/docs/dashboard/projects-runs",
        label: "Projects & runs",
        desc: "Run detail, trial inspector, compare, model matrix.",
      },
      {
        href: "/docs/dashboard/settings-billing",
        label: "Settings & billing",
        desc: "API keys, plans, roles, and usage.",
      },
    ],
  },
];

const QUICK_LINKS = [
  { href: "/docs/quickstart", label: "Quickstart", icon: Zap },
  { href: "/docs/reference/cli", label: "CLI reference", icon: Terminal },
  {
    href: "/docs/guides/ci-github-actions",
    label: "CI setup",
    icon: GitBranch,
  },
  {
    href: "/docs/reference/assertions",
    label: "Assertions",
    icon: Gauge,
  },
];

export default function DocsIndexPage() {
  return (
    <>
      {/* Hero */}
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
            <BookOpen className="size-3.5 text-chart-1" aria-hidden />
            Documentation
          </div>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            ToolGrade docs
          </h1>
          <p className="mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
            Everything you need to add eval-first quality gates to your MCP
            server — from first run to production CI.
          </p>
          {/* Quick links */}
          <div className="mt-8 flex flex-wrap gap-3">
            {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 rounded-lg border bg-background/60 px-3.5 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-muted"
              >
                <Icon className="size-4 text-chart-1" aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Sections grid */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 sm:grid-cols-2">
          {SECTIONS.map(
            ({ eyebrow, title, description, icon: Icon, links }) => (
              <div key={title} className="reveal">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg border bg-muted">
                    <Icon className="size-4 text-chart-1" aria-hidden />
                  </span>
                  <span className="text-xs font-semibold tracking-widest text-chart-1 uppercase">
                    {eyebrow}
                  </span>
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-tight">
                  {title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
                <ul className="mt-4 space-y-1">
                  {links.map(({ href, label, desc }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
                      >
                        <span className="mt-0.5 text-sm font-medium group-hover:text-foreground">
                          {label}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {desc}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      </section>
    </>
  );
}
