"use client";

import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeSearchText,
  type SearchOption,
} from "@/lib/search-option";

const triggerClass =
  "mt-1 flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-hushed disabled:text-ink-soft";
const searchInputClass =
  "w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

type SearchableComboboxProps = {
  id: string;
  label: string;
  value: string;
  options: readonly SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  helpText?: string;
  error?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
};

function filterOptions(
  options: readonly SearchOption[],
  query: string,
): SearchOption[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [...options];
  }

  return options.filter((option) => {
    const haystack = normalizeSearchText(
      [
        option.label,
        option.value,
        option.description ?? "",
        option.group ?? "",
        option.searchText ?? "",
      ].join(" "),
    );

    return haystack.includes(normalizedQuery);
  });
}

export function SearchableCombobox({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  helpText,
  error,
  disabled = false,
  allowClear = false,
  className = "",
}: SearchableComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = filterOptions(options, query);
  const describedBy = [helpText ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleOutsidePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
        setActiveIndex(-1);
      }
    }

    document.addEventListener("mousedown", handleOutsidePointer);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) {
      return;
    }

    document
      .getElementById(`${id}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, isOpen]);

  function closeMenu(focusTrigger = false) {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);

    if (focusTrigger) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openMenu() {
    if (disabled) {
      return;
    }

    const selectedIndex = options.findIndex(
      (option) => option.value === value,
    );

    setQuery("");
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length ? 0 : -1);
    setIsOpen(true);
  }

  function selectOption(option: SearchOption) {
    onChange(option.value);
    closeMenu(true);
  }

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    const nextOptions = filterOptions(options, nextQuery);
    setActiveIndex(nextOptions.length > 0 ? 0 : -1);
  }

  function moveActive(direction: 1 | -1) {
    if (filteredOptions.length === 0) {
      return;
    }

    setActiveIndex((current) => {
      if (current < 0) {
        return direction === 1 ? 0 : filteredOptions.length - 1;
      }

      return (
        (current + direction + filteredOptions.length) %
        filteredOptions.length
      );
    });
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(
        filteredOptions.length > 0 ? filteredOptions.length - 1 : -1,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[activeIndex];

      if (option) {
        selectOption(option);
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.key === "Tab") {
      closeMenu(false);
    }
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <label
          id={labelId}
          htmlFor={id}
          className="block text-sm font-medium text-ink"
        >
          {label}
        </label>
        {allowClear && value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              closeMenu(true);
            }}
            disabled={disabled}
            aria-label={`Clear ${label}`}
            className="text-xs font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
          >
            Clear
          </button>
        ) : null}
      </div>

      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-describedby={describedBy || undefined}
        data-invalid={error ? true : undefined}
        onClick={() => {
          if (isOpen) {
            closeMenu(true);
          } else {
            openMenu();
          }
        }}
        className={`${triggerClass} ${
          error ? "border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)]" : ""
        }`}
      >
        <span className="truncate">
          {selectedOption?.label ?? placeholder}
        </span>
        <span aria-hidden="true" className="shrink-0 text-ink-faint">
          ▾
        </span>
      </button>

      {helpText ? (
        <p id={helpId} className="mt-1 text-xs text-ink-soft">
          {helpText}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
          {error}
        </p>
      ) : null}

      {isOpen ? (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-surface shadow-lg">
          <div className="sticky top-0 border-b border-line bg-surface p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-labelledby={labelId}
              aria-activedescendant={
                activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
              }
              aria-describedby={describedBy || undefined}
              placeholder={`Search ${label.toLowerCase()}…`}
              className={searchInputClass}
            />
          </div>

          {filteredOptions.length === 0 ? (
            <p role="status" className="px-3 py-4 text-sm text-ink-soft">
              No matches found.
            </p>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-labelledby={labelId}
              className="py-1"
            >
              {filteredOptions.map((option, index) => {
                const showGroup = Boolean(
                  option.group &&
                    option.group !== filteredOptions[index - 1]?.group,
                );

                return (
                  <Fragment key={option.value}>
                    {showGroup ? (
                      <li
                        role="presentation"
                        className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                      >
                        {option.group}
                      </li>
                    ) : null}
                    <li
                      id={`${id}-option-${index}`}
                      role="option"
                      aria-selected={option.value === value}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectOption(option)}
                      className={`cursor-pointer px-3 py-2 text-sm ${
                        index === activeIndex
                          ? "bg-accent-soft text-ink"
                          : "text-ink"
                      }`}
                    >
                      <span className="block break-words">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block break-words text-xs text-ink-soft">
                          {option.description}
                        </span>
                      ) : null}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
