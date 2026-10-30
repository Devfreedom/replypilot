"use client";

import { useId } from "react";
import {
  type ScheduleErrors,
  type WeeklySchedule,
  WEEKDAY_LABELS,
  canCopyMondayToWeekdays,
  copyMondayToWeekdays,
  setDayOpen,
  setDayTime,
} from "@/lib/opening-hours";

const timeInputClass =
  "mt-1 block w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none disabled:bg-hushed";

type OpeningHoursEditorProps = {
  schedule: WeeklySchedule;
  errors: ScheduleErrors;
  disabled?: boolean;
  onChange: (schedule: WeeklySchedule) => void;
};

export function OpeningHoursEditor({
  schedule,
  errors,
  disabled = false,
  onChange,
}: OpeningHoursEditorProps) {
  const idPrefix = useId();
  const allClosed = schedule.every((row) => !row.isOpen);
  const copyEnabled = canCopyMondayToWeekdays(schedule);
  const hasErrors = Object.keys(errors).length > 0;

  function fieldId(day: string, field: "opensAt" | "closesAt"): string {
    return `${idPrefix}-${day}-${field}`;
  }

  function errorId(day: string, field: "opensAt" | "closesAt"): string {
    return `${fieldId(day, field)}-error`;
  }

  return (
    <fieldset
      className="min-w-0 rounded-2xl border border-line bg-hushed/60 p-4 sm:col-span-2 sm:p-5"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-semibold text-ink">
        Opening hours
      </legend>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-ink-soft">
          Choose the days you operate, then set one opening and closing time
          for each open day. Closed days are saved without times.
        </p>
        <button
          type="button"
          onClick={() => onChange(copyMondayToWeekdays(schedule))}
          disabled={disabled || !copyEnabled}
          aria-describedby={`${idPrefix}-copy-help`}
          className="btn btn-secondary px-3 py-2"
        >
          Copy Monday to weekdays
        </button>
      </div>

      <p id={`${idPrefix}-copy-help`} className="mt-1 text-xs text-ink-soft">
        {copyEnabled
          ? "This copies Monday's hours to Tuesday–Friday only. It does not save the profile."
          : "Set valid Monday opening and closing times to enable copying to Tuesday–Friday."}
      </p>

      <p className="mt-2 text-xs text-ink-soft">
        One same-day period per day is supported. Overnight hours and split
        shifts are not supported yet.
      </p>

      {allClosed ? (
        <p className="mt-3 rounded-xl border border-[color-mix(in_oklab,var(--rp-accent)_25%,transparent)] bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          No days are open yet. Select Open for the days you operate. Nothing is
          saved until you save the profile.
        </p>
      ) : null}

      {hasErrors ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink"
        >
          Please correct the highlighted opening-hours fields.
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-line border-t border-line">
        {schedule.map((row) => {
          const label = WEEKDAY_LABELS[row.day];
          const dayErrors = errors[row.day];
          const toggleId = `${idPrefix}-${row.day}-open`;
          const dayLabelId = `${idPrefix}-${row.day}-label`;

          return (
            <li key={row.day} className="py-4">
              <div
                role="group"
                aria-labelledby={dayLabelId}
                className="grid gap-3 sm:grid-cols-[7rem_7.5rem_minmax(0,1fr)] sm:items-start"
              >
                <p
                  id={dayLabelId}
                  className="text-sm font-semibold text-ink"
                >
                  {label}
                </p>

                <label
                  htmlFor={toggleId}
                  className="inline-flex w-fit cursor-pointer items-center gap-2 text-sm font-medium text-ink"
                >
                  <input
                    id={toggleId}
                    type="checkbox"
                    checked={row.isOpen}
                    onChange={(event) =>
                      onChange(
                        setDayOpen(schedule, row.day, event.target.checked),
                      )
                    }
                    aria-label={`${label} open`}
                    className="checkbox"
                  />
                  {row.isOpen ? "Open" : "Closed"}
                </label>

                {row.isOpen ? (
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label
                        htmlFor={fieldId(row.day, "opensAt")}
                        className="block text-xs font-medium text-ink-soft"
                      >
                        Opens
                      </label>
                      <input
                        id={fieldId(row.day, "opensAt")}
                        type="time"
                        value={row.opensAt}
                        onChange={(event) =>
                          onChange(
                            setDayTime(
                              schedule,
                              row.day,
                              "opensAt",
                              event.target.value,
                            ),
                          )
                        }
                        aria-invalid={dayErrors?.opensAt ? true : undefined}
                        aria-describedby={
                          dayErrors?.opensAt
                            ? errorId(row.day, "opensAt")
                            : undefined
                        }
                        className={`${timeInputClass} ${
                          dayErrors?.opensAt ? "border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft" : ""
                        }`}
                      />
                      {dayErrors?.opensAt ? (
                        <p
                          id={errorId(row.day, "opensAt")}
                          className="mt-1 text-xs font-medium text-danger-ink"
                        >
                          {dayErrors.opensAt}
                        </p>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor={fieldId(row.day, "closesAt")}
                        className="block text-xs font-medium text-ink-soft"
                      >
                        Closes
                      </label>
                      <input
                        id={fieldId(row.day, "closesAt")}
                        type="time"
                        value={row.closesAt}
                        onChange={(event) =>
                          onChange(
                            setDayTime(
                              schedule,
                              row.day,
                              "closesAt",
                              event.target.value,
                            ),
                          )
                        }
                        aria-invalid={dayErrors?.closesAt ? true : undefined}
                        aria-describedby={
                          dayErrors?.closesAt
                            ? errorId(row.day, "closesAt")
                            : undefined
                        }
                        className={`${timeInputClass} ${
                          dayErrors?.closesAt ? "border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft" : ""
                        }`}
                      />
                      {dayErrors?.closesAt ? (
                        <p
                          id={errorId(row.day, "closesAt")}
                          className="mt-1 text-xs font-medium text-danger-ink"
                        >
                          {dayErrors.closesAt}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="self-center text-sm text-ink-soft">
                    Closed all day
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
