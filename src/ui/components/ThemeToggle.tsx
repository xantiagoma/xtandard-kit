import React, { useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import type { ThemePref, ThemeStore } from "../theme.ts";
import { useTheme } from "../theme-context.tsx";
import { cn } from "../lib/utils.ts";

const OPTIONS: { value: ThemePref; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

/** Props for {@link ThemeToggle}. */
export interface ThemeToggleProps {
  /** The store to read and write; defaults to the enclosing {@link ThemeProvider}'s. */
  store?: ThemeStore;
}

/**
 * The system/light/dark switcher. It persists the choice in the product's theme store (the `store`
 * prop, else the enclosing `ThemeProvider`'s).
 */
export function ThemeToggle({ store: storeProp }: ThemeToggleProps = {}): React.ReactElement {
  const ctx = useTheme();
  const store = storeProp ?? ctx.store;
  if (!store) throw new Error("ThemeToggle needs a `store` prop or an enclosing <ThemeProvider>.");
  const [pref, setPref] = useState<ThemePref>(() => store.getThemePref());

  const choose = (value: ThemePref) => {
    setPref(value);
    store.setThemePref(value);
  };

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => choose(value)}
            className={cn(
              "inline-flex h-6 w-7 items-center justify-center rounded-[5px] outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
