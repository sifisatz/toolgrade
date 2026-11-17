"use client";

import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CTA } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/benchmark", label: "Benchmark" },
  { href: "/docs", label: "Docs" },
  { href: "/#pricing", label: "Pricing" },
];

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-colors duration-300",
        scrolled
          ? "border-border bg-background/75 backdrop-blur-xl"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
        <Logo />
        <nav
          className="hidden items-center gap-6 text-sm text-muted-foreground md:flex"
          aria-label="Main"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Button
            size="sm"
            variant="ghost"
            className="hidden sm:inline-flex"
            render={<Link href={CTA.signIn.href} />}
          >
            {CTA.signIn.label}
          </Button>
          <Button
            size="sm"
            className="shine hidden sm:inline-flex"
            render={<Link href={CTA.primary.href} />}
          >
            {CTA.primary.label} <ArrowRight />
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label="Open menu"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-6">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <nav className="mt-6 grid gap-1 text-base" aria-label="Mobile">
                {LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-2 hover:bg-muted"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 grid gap-2">
                <Button
                  variant="outline"
                  render={<Link href={CTA.signIn.href} />}
                >
                  {CTA.signIn.label}
                </Button>
                <Button render={<Link href={CTA.primary.href} />}>
                  {CTA.primary.label}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
