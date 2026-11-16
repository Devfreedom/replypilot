"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

export type ThemeChoice = "light" | "dark" | "system";

/**
 * Shared with the inline theme initialisation script in src/app/layout.tsx so
 * both read and write the same persisted preference.
 */
export const THEME_STORAGE_KEY = BRAND.storageThemeKey;

const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "light") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        className="h-3.5 w-3.5"
      >
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7 14 6M6 14l-1.3 1.3" />
      </svg>
    );
  }

  if (choice === "dark") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
      >
        <path d="M16 11.7A6.5 6.5 0 0 1 8.3 4 6.5 6.5 0 1 0 16 11.7Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-3.5 w-3.5"
    >
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5v13a6.5 6.5 0 0 0 0-13Z" fill="currentColor" />
    </svg>
  );
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }

  return choice;
}

function readStoredChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice: ThemeChoice) {
  const resolved = resolveTheme(choice);
  document.documentElement.setAttribute("data-theme", resolved);
}

// Runs before paint on the client and is a no-op during server rendering.
const useBeforePaint =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Light/Dark/System theme selector.
 *
 * - The resolved theme (`data-theme` on <html>) is applied by the inline script
 *   in the root layout before the first paint, so there is no flash.
 * - This selector manages the persisted preference and keeps `data-theme` in
 *   sync after the selection changes or the OS theme changes while System is
 *   selected.
 */
export function ThemeSelect() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  // Keep React state in sync with the preference the inline script applied.
  useBeforePaint(() => {
    const stored = readStoredChoice();
    setChoice(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function onMediaChange() {
      if (readStoredChoice() === "system") {
        applyTheme("system");
      }
    }

    media.addEventListener("change", onMediaChange);

    return () => {
      media.removeEventListener("change", onMediaChange);
    };
  }, []);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY) {
        const stored = readStoredChoice();
        setChoice(stored);
        applyTheme(stored);
      }
    }

    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function selectTheme(next: ThemeChoice) {
    if (next === choice) return;

    setChoice(next);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is unavailable; the theme still applies for this session.
    }

    applyTheme(next);
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex shrink-0 items-center rounded-xl border border-line bg-hushed p-1"
    >
      {THEME_CHOICES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={choice === option.value}
          onClick={() => selectTheme(option.value)}
          title={`Theme: ${option.label}`}
          className={`inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            choice === option.value
              ? "bg-surface text-ink shadow-xs ring-1 ring-line"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          <ThemeIcon choice={option.value} />
          {/* Below sm the control shows icons only so the mobile top bar keeps
              room for the breadcrumb; the label stays available to screen
              readers. */}
          <span className="hidden sm:inline">{option.label}</span>
          <span className="sr-only sm:hidden">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
