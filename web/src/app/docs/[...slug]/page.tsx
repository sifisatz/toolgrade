"use server";

import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ALL_DOC_SLUGS,
  DOC_SECTIONS,
  findDocLink,
  getDocContent,
} from "@/lib/docs";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ slug: string[] }> };

export async function generateStaticParams() {
  return ALL_DOC_SLUGS.map((s) => ({ slug: s.split("/") }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const joined = slug.join("/");
  const link = findDocLink(joined);
  return { title: link?.title ?? "Docs" };
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const joined = slug.join("/");
  const html = await getDocContent(joined);
  if (!html) notFound();

  const currentLink = findDocLink(joined);

  // Build flat ordered list for prev/next
  const allLinks = DOC_SECTIONS.flatMap((s) => s.items);
  const currentIdx = allLinks.findIndex((l) => l.slug === joined);
  const prev = currentIdx > 0 ? allLinks[currentIdx - 1] : null;
  const next =
    currentIdx < allLinks.length - 1 ? allLinks[currentIdx + 1] : null;

  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav aria-label="Documentation" className="sticky top-20">
          <Link
            href="/docs"
            className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className="size-3 rotate-180" aria-hidden />
            All docs
          </Link>
          {DOC_SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              <div className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {section.title}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={`/docs/${item.slug}`}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        item.slug === joined
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Mobile back link */}
        <Link
          href="/docs"
          className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <ChevronRight className="size-3 rotate-180" aria-hidden />
          All docs
        </Link>

        <article
          className="prose prose-neutral dark:prose-invert max-w-none
            prose-headings:font-semibold prose-headings:tracking-tight
            prose-h1:text-3xl prose-h1:mb-6
            prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-3 prose-h2:border-b prose-h2:pb-2
            prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2
            prose-p:text-muted-foreground prose-p:leading-relaxed
            prose-a:text-chart-1 prose-a:no-underline hover:prose-a:underline
            prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
            prose-pre:rounded-xl prose-pre:border prose-pre:bg-muted/60 prose-pre:text-sm
            prose-table:text-sm prose-th:text-xs prose-th:font-semibold prose-th:tracking-wide prose-th:uppercase
            prose-blockquote:border-l-chart-1 prose-blockquote:text-muted-foreground
            prose-hr:border-border
            prose-li:text-muted-foreground"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static docs content
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Prev / Next navigation */}
        {(prev || next) && (
          <nav
            aria-label="Doc navigation"
            className="mt-14 flex flex-col gap-3 border-t pt-8 sm:flex-row sm:justify-between"
          >
            {prev ? (
              <Link
                href={`/docs/${prev.slug}`}
                className="group flex max-w-[48%] flex-col gap-0.5 rounded-xl border p-4 transition-colors hover:bg-muted"
              >
                <span className="text-xs text-muted-foreground">Previous</span>
                <span className="font-medium leading-tight group-hover:text-foreground">
                  {prev.title}
                </span>
              </Link>
            ) : (
              <div />
            )}
            {next && (
              <Link
                href={`/docs/${next.slug}`}
                className="group flex max-w-[48%] flex-col gap-0.5 rounded-xl border p-4 text-right transition-colors hover:bg-muted sm:ml-auto"
              >
                <span className="text-xs text-muted-foreground">Next</span>
                <span className="font-medium leading-tight group-hover:text-foreground">
                  {next.title}
                </span>
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
