export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/**
 * The shape accepted by the existing business-profile API. Closed days are
 * omitted; there is exactly one same-day interval per open day.
 */
export type OpeningHoursEntry = {
  day: Weekday;
  opensAt: string;
  closesAt: string;
};

export type DaySchedule = {
  day: Weekday;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
};

export type WeeklySchedule = DaySchedule[];

export type ScheduleFieldErrors = {
  opensAt?: string;
  closesAt?: string;
};

export type ScheduleErrors = Partial<Record<Weekday, ScheduleFieldErrors>>;

export type ScheduleLoadResult = {
  schedule: WeeklySchedule;
  issues: string[];
  /** True when saved entries cannot be represented without losing data. */
  hasUneditableEntries: boolean;
};

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const COPY_TARGETS = new Set<Weekday>([
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
]);

export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * Creates a blank editor state. Every day starts closed with empty times so
 * the UI never assumes business hours that the user did not choose.
 */
export function createEmptyWeeklySchedule(): WeeklySchedule {
  return WEEKDAYS.map((day) => ({
    day,
    isOpen: false,
    opensAt: "",
    closesAt: "",
  }));
}

/**
 * Converts the persisted API array into exactly seven editor rows. Normal
 * legacy values (for example an overnight interval) are surfaced as issues
 * for review. Duplicate or unsupported days cannot be represented safely, so
 * they are reported and must be explicitly replaced in the editor.
 */
export function scheduleFromOpeningHours(
  entries: readonly OpeningHoursEntry[],
): ScheduleLoadResult {
  const savedByDay = new Map<Weekday, OpeningHoursEntry>();
  const issues: string[] = [];
  let hasUneditableEntries = false;

  for (const entry of entries) {
    if (!isWeekday(entry.day)) {
      issues.push(
        `The saved schedule contains an unsupported day (${String(entry.day)}).`,
      );
      hasUneditableEntries = true;
      continue;
    }

    if (savedByDay.has(entry.day)) {
      issues.push(
        `${WEEKDAY_LABELS[entry.day]} has more than one saved interval. Only the first is shown.`,
      );
      hasUneditableEntries = true;
      continue;
    }

    savedByDay.set(entry.day, entry);
  }

  const schedule = WEEKDAYS.map((day): DaySchedule => {
    const saved = savedByDay.get(day);

    if (!saved) {
      return {
        day,
        isOpen: false,
        opensAt: "",
        closesAt: "",
      };
    }

    if (!isValidTime(saved.opensAt)) {
      issues.push(
        `${WEEKDAY_LABELS[day]} has an invalid saved opening time (${saved.opensAt}). Choose a new time.`,
      );
    }

    if (!isValidTime(saved.closesAt)) {
      issues.push(
        `${WEEKDAY_LABELS[day]} has an invalid saved closing time (${saved.closesAt}). Choose a new time.`,
      );
    }

    const opensAt = isValidTime(saved.opensAt) ? saved.opensAt : "";
    const closesAt = isValidTime(saved.closesAt) ? saved.closesAt : "";

    if (
      opensAt &&
      closesAt &&
      closesAt <= opensAt
    ) {
      issues.push(
        `${WEEKDAY_LABELS[day]} closes at or before it opens (${opensAt}–${closesAt}). Overnight hours are not supported.`,
      );
    }

    return {
      day,
      isOpen: true,
      opensAt,
      closesAt,
    };
  });

  return { schedule, issues, hasUneditableEntries };
}

/**
 * Converts editor rows back to the existing API shape. Only open days are
 * serialized; closed days keep their local time values for the current edit
 * session but are not sent to the API.
 */
export function openingHoursFromSchedule(
  schedule: readonly DaySchedule[],
): OpeningHoursEntry[] {
  const byDay = new Map<Weekday, DaySchedule>();
  const openingHours: OpeningHoursEntry[] = [];

  for (const row of schedule) {
    byDay.set(row.day, row);
  }

  for (const day of WEEKDAYS) {
    const row = byDay.get(day);

    if (row?.isOpen) {
      openingHours.push({
        day,
        opensAt: row.opensAt,
        closesAt: row.closesAt,
      });
    }
  }

  return openingHours;
}

export function validateWeeklySchedule(
  schedule: readonly DaySchedule[],
): ScheduleErrors {
  const errors: ScheduleErrors = {};

  for (const row of schedule) {
    if (!row.isOpen) {
      continue;
    }

    const dayErrors: ScheduleFieldErrors = {};

    if (!row.opensAt) {
      dayErrors.opensAt = "Choose an opening time.";
    } else if (!isValidTime(row.opensAt)) {
      dayErrors.opensAt = "Enter a valid opening time.";
    }

    if (!row.closesAt) {
      dayErrors.closesAt = "Choose a closing time.";
    } else if (!isValidTime(row.closesAt)) {
      dayErrors.closesAt = "Enter a valid closing time.";
    }

    if (
      !dayErrors.opensAt &&
      !dayErrors.closesAt &&
      row.closesAt <= row.opensAt
    ) {
      dayErrors.closesAt = "Closing time must be after opening time.";
    }

    if (dayErrors.opensAt || dayErrors.closesAt) {
      errors[row.day] = dayErrors;
    }
  }

  return errors;
}

export function hasScheduleErrors(errors: ScheduleErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function setDayOpen(
  schedule: readonly DaySchedule[],
  day: Weekday,
  isOpen: boolean,
): WeeklySchedule {
  return schedule.map((row) => (row.day === day ? { ...row, isOpen } : row));
}

export function setDayTime(
  schedule: readonly DaySchedule[],
  day: Weekday,
  field: "opensAt" | "closesAt",
  value: string,
): WeeklySchedule {
  return schedule.map((row) =>
    row.day === day ? { ...row, [field]: value } : row,
  );
}

export function canCopyMondayToWeekdays(
  schedule: readonly DaySchedule[],
): boolean {
  const monday = schedule.find((row) => row.day === "monday");

  return Boolean(
    monday?.isOpen &&
      isValidTime(monday.opensAt) &&
      isValidTime(monday.closesAt) &&
      monday.closesAt > monday.opensAt,
  );
}

/**
 * Copies Monday's valid open interval to Tuesday through Friday. It does not
 * save anything; the caller must still submit the profile form.
 */
export function copyMondayToWeekdays(
  schedule: readonly DaySchedule[],
): WeeklySchedule {
  const monday = schedule.find((row) => row.day === "monday");

  if (!monday || !canCopyMondayToWeekdays(schedule)) {
    return schedule.map((row) => ({ ...row }));
  }

  return schedule.map((row) =>
    COPY_TARGETS.has(row.day)
      ? {
          ...row,
          isOpen: true,
          opensAt: monday.opensAt,
          closesAt: monday.closesAt,
        }
      : { ...row },
  );
}
