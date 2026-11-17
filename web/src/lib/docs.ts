import { readFileSync } from "fs";
import { marked } from "marked";
import path from "path";

export type DocLink = {
  title: string;
  slug: string; // path relative to docs root, without .md
};

export type DocSection = {
  title: string;
  items: DocLink[];
};

export const DOC_SECTIONS: DocSection[] = [
  {
    title: "Getting started",
    items: [
      { title: "What is ToolGrade?", slug: "what-is-toolgrade" },
      { title: "5-minute quickstart", slug: "quickstart" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Writing your first suite", slug: "guides/writing-your-first-suite" },
      { title: "Understanding results", slug: "guides/understanding-results" },
      { title: "GitHub Actions CI", slug: "guides/ci-github-actions" },
      { title: "Using Ollama locally", slug: "guides/using-ollama-locally" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "CLI reference", slug: "reference/cli" },
      { title: "Suite YAML reference", slug: "reference/suite-yaml" },
      { title: "Assertions", slug: "reference/assertions" },
      { title: "Platform API", slug: "reference/api" },
    ],
  },
  {
    title: "Dashboard",
    items: [
      { title: "Overview", slug: "dashboard/overview" },
      { title: "Projects & runs", slug: "dashboard/projects-runs" },
      { title: "Settings & billing", slug: "dashboard/settings-billing" },
    ],
  },
];

export const ALL_DOC_SLUGS: string[] = DOC_SECTIONS.flatMap((s) =>
  s.items.map((i) => i.slug),
);

const DOCS_DIR = path.join(process.cwd(), "..", "docs");

export async function getDocContent(slug: string): Promise<string | null> {
  const filePath = path.join(DOCS_DIR, `${slug}.md`);
  try {
    const raw = readFileSync(filePath, "utf-8");
    // Rewrite relative markdown links to work in the /docs/ URL space.
    // e.g., ../reference/cli.md -> /docs/reference/cli
    //       ./guides/writing.md -> /docs/guides/writing
    const rewritten = raw.replace(
      /\[([^\]]+)\]\(\.\.?\/([^)]+)\.md\)/g,
      (_, text, rest) => `[${text}](/docs/${rest})`,
    ).replace(
      /\[([^\]]+)\]\(\.\/([^)]+)\.md\)/g,
      (_, text, rest) => `[${text}](/docs/${rest})`,
    );
    return await marked(rewritten, { gfm: true, breaks: false });
  } catch {
    return null;
  }
}

export function findDocLink(slug: string): DocLink | undefined {
  return DOC_SECTIONS.flatMap((s) => s.items).find((i) => i.slug === slug);
}
