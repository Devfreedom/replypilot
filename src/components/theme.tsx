"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

/**
 * Shared with the inline theme initialisation script in src/app/layout.tsx so
 * both read and write the same persisted preference.
 */
export const THEME_STORAGE_KEY = "replypilot-theme";

const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

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
          className={`cursor-pointer rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
            choice === option.value
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          <span aria-hidden="true">
            {option.value === "light" ? "☀" : option.value === "dark" ? "☾" : "◐"}
          </span>
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
