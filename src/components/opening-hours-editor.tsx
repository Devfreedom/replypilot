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
  "mt-1 block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-slate-50";

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
      className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:col-span-2 sm:p-5"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-semibold text-slate-800">
        Opening hours
      </legend>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-slate-600">
          Choose the days you operate, then set one opening and closing time
          for each open day. Closed days are saved without times.
        </p>
        <button
          type="button"
          onClick={() => onChange(copyMondayToWeekdays(schedule))}
          disabled={disabled || !copyEnabled}
          aria-describedby={`${idPrefix}-copy-help`}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Copy Monday to weekdays
        </button>
      </div>

      <p id={`${idPrefix}-copy-help`} className="mt-1 text-xs text-slate-500">
        {copyEnabled
          ? "This copies Monday's hours to Tuesday–Friday only. It does not save the profile."
          : "Set valid Monday opening and closing times to enable copying to Tuesday–Friday."}
      </p>

      <p className="mt-2 text-xs text-slate-500">
        One same-day period per day is supported. Overnight hours and split
        shifts are not supported yet.
      </p>

      {allClosed ? (
        <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          No days are open yet. Select Open for the days you operate. Nothing is
          saved until you save the profile.
        </p>
      ) : null}

      {hasErrors ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          Please correct the highlighted opening-hours fields.
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
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
                  className="text-sm font-semibold text-slate-800"
                >
                  {label}
                </p>

                <label
                  htmlFor={toggleId}
                  className="inline-flex w-fit cursor-pointer items-center gap-2 text-sm font-medium text-slate-700"
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
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  />
                  {row.isOpen ? "Open" : "Closed"}
                </label>

                {row.isOpen ? (
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label
                        htmlFor={fieldId(row.day, "opensAt")}
                        className="block text-xs font-medium text-slate-600"
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
                          dayErrors?.opensAt ? "border-red-300 bg-red-50" : ""
                        }`}
                      />
                      {dayErrors?.opensAt ? (
                        <p
                          id={errorId(row.day, "opensAt")}
                          className="mt-1 text-xs font-medium text-red-700"
                        >
                          {dayErrors.opensAt}
                        </p>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor={fieldId(row.day, "closesAt")}
                        className="block text-xs font-medium text-slate-600"
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
                          dayErrors?.closesAt ? "border-red-300 bg-red-50" : ""
                        }`}
                      />
                      {dayErrors?.closesAt ? (
                        <p
                          id={errorId(row.day, "closesAt")}
                          className="mt-1 text-xs font-medium text-red-700"
                        >
                          {dayErrors.closesAt}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="self-center text-sm text-slate-500">
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
