"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}

const NEXT = { system: "light", light: "dark", dark: "system" } as const;
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? theme : "system") as keyof typeof NEXT;
  const Icon = ICON[current] ?? Monitor;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Theme: ${current}. Switch to ${NEXT[current]}`}
      onClick={() => setTheme(NEXT[current])}
    >
      <Icon />
    </Button>
  );
}
