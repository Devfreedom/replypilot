import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DaySchedule,
  type OpeningHoursEntry,
  canCopyMondayToWeekdays,
  copyMondayToWeekdays,
  createEmptyWeeklySchedule,
  hasScheduleErrors,
  openingHoursFromSchedule,
  scheduleFromOpeningHours,
  setDayOpen,
  setDayTime,
  validateWeeklySchedule,
  WEEKDAYS,
} from "../../src/lib/opening-hours.js";

function row(schedule: readonly DaySchedule[], day: DaySchedule["day"]) {
  const match = schedule.find((entry) => entry.day === day);

  assert.ok(match, `Expected a schedule row for ${day}`);
  return match;
}

const weekdayHours: OpeningHoursEntry[] = [
  { day: "monday", opensAt: "09:00", closesAt: "17:00" },
  { day: "tuesday", opensAt: "09:00", closesAt: "17:00" },
  { day: "wednesday", opensAt: "09:00", closesAt: "17:00" },
  { day: "thursday", opensAt: "09:00", closesAt: "17:00" },
  { day: "friday", opensAt: "09:00", closesAt: "17:00" },
];

test("an empty editor is valid and serializes to no opening hours", () => {
  const schedule = createEmptyWeeklySchedule();

  assert.equal(schedule.length, 7);
  assert.ok(schedule.every((entry) => !entry.isOpen));
  assert.ok(schedule.every((entry) => entry.opensAt === ""));
  assert.ok(schedule.every((entry) => entry.closesAt === ""));
  assert.deepEqual(validateWeeklySchedule(schedule), {});
  assert.deepEqual(openingHoursFromSchedule(schedule), []);
});

test("a typical weekday schedule round-trips through the editor", () => {
  const loaded = scheduleFromOpeningHours(weekdayHours);

  assert.equal(loaded.issues.length, 0);
  assert.equal(loaded.hasUneditableEntries, false);
  assert.deepEqual(openingHoursFromSchedule(loaded.schedule), weekdayHours);
  assert.deepEqual(validateWeeklySchedule(loaded.schedule), {});
  assert.ok(WEEKDAYS.every((day) => {
    const expectedOpen = weekdayHours.some((entry) => entry.day === day);
    return row(loaded.schedule, day).isOpen === expectedOpen;
  }));
});

test("different hours on different days are preserved", () => {
  const saved: OpeningHoursEntry[] = [
    { day: "monday", opensAt: "09:00", closesAt: "17:00" },
    { day: "wednesday", opensAt: "10:30", closesAt: "19:00" },
    { day: "saturday", opensAt: "08:00", closesAt: "12:00" },
  ];

  const loaded = scheduleFromOpeningHours(saved);

  assert.equal(row(loaded.schedule, "monday").opensAt, "09:00");
  assert.equal(row(loaded.schedule, "wednesday").opensAt, "10:30");
  assert.equal(row(loaded.schedule, "wednesday").closesAt, "19:00");
  assert.equal(row(loaded.schedule, "saturday").closesAt, "12:00");
  assert.deepEqual(openingHoursFromSchedule(loaded.schedule), saved);
});

test("toggling a day closed keeps its local times and omits it from the API payload", () => {
  const loaded = scheduleFromOpeningHours(weekdayHours);
  const closedTuesday = setDayOpen(loaded.schedule, "tuesday", false);
  const tuesday = row(closedTuesday, "tuesday");

  assert.equal(tuesday.isOpen, false);
  assert.equal(tuesday.opensAt, "09:00");
  assert.equal(tuesday.closesAt, "17:00");
  assert.deepEqual(
    openingHoursFromSchedule(closedTuesday).map((entry) => entry.day),
    ["monday", "wednesday", "thursday", "friday"],
  );

  const reopenedTuesday = setDayOpen(closedTuesday, "tuesday", true);
  assert.equal(row(reopenedTuesday, "tuesday").opensAt, "09:00");
  assert.equal(row(reopenedTuesday, "tuesday").closesAt, "17:00");
  assert.deepEqual(openingHoursFromSchedule(reopenedTuesday), weekdayHours);
});

test("open days require both opening and closing times", () => {
  const mondayOpen = setDayOpen(createEmptyWeeklySchedule(), "monday", true);
  const bothMissing = validateWeeklySchedule(mondayOpen);

  assert.equal(bothMissing.monday?.opensAt, "Choose an opening time.");
  assert.equal(bothMissing.monday?.closesAt, "Choose a closing time.");
  assert.equal(hasScheduleErrors(bothMissing), true);

  const openingOnly = setDayTime(mondayOpen, "monday", "opensAt", "09:00");
  const closingMissing = validateWeeklySchedule(openingOnly);

  assert.equal(closingMissing.monday?.opensAt, undefined);
  assert.equal(closingMissing.monday?.closesAt, "Choose a closing time.");
});

test("closing time must be later than opening time", () => {
  let schedule = setDayOpen(createEmptyWeeklySchedule(), "monday", true);
  schedule = setDayTime(schedule, "monday", "opensAt", "10:00");
  schedule = setDayTime(schedule, "monday", "closesAt", "10:00");

  assert.equal(
    validateWeeklySchedule(schedule).monday?.closesAt,
    "Closing time must be after opening time.",
  );

  schedule = setDayTime(schedule, "monday", "closesAt", "09:59");
  assert.equal(
    validateWeeklySchedule(schedule).monday?.closesAt,
    "Closing time must be after opening time.",
  );

  schedule = setDayTime(schedule, "monday", "closesAt", "10:01");
  assert.deepEqual(validateWeeklySchedule(schedule), {});
});

test("copying Monday to weekdays opens Tuesday through Friday only", () => {
  let schedule = setDayOpen(createEmptyWeeklySchedule(), "monday", true);
  schedule = setDayTime(schedule, "monday", "opensAt", "09:00");
  schedule = setDayTime(schedule, "monday", "closesAt", "17:00");

  assert.equal(canCopyMondayToWeekdays(schedule), true);

  const copied = copyMondayToWeekdays(schedule);

  for (const day of ["tuesday", "wednesday", "thursday", "friday"] as const) {
    assert.equal(row(copied, day).isOpen, true);
    assert.equal(row(copied, day).opensAt, "09:00");
    assert.equal(row(copied, day).closesAt, "17:00");
  }

  assert.equal(row(copied, "saturday").isOpen, false);
  assert.equal(row(copied, "sunday").isOpen, false);
});

test("the copy action does nothing until Monday has valid hours", () => {
  const closed = createEmptyWeeklySchedule();

  assert.equal(canCopyMondayToWeekdays(closed), false);
  assert.deepEqual(copyMondayToWeekdays(closed), closed);

  const openWithoutTimes = setDayOpen(closed, "monday", true);
  assert.equal(canCopyMondayToWeekdays(openWithoutTimes), false);
  assert.deepEqual(copyMondayToWeekdays(openWithoutTimes), openWithoutTimes);
});

test("invalid saved times are surfaced for correction without inventing values", () => {
  const loaded = scheduleFromOpeningHours([
    { day: "monday", opensAt: "9:00", closesAt: "17:00" },
  ]);

  assert.equal(row(loaded.schedule, "monday").isOpen, true);
  assert.equal(row(loaded.schedule, "monday").opensAt, "");
  assert.equal(loaded.hasUneditableEntries, false);
  assert.ok(loaded.issues.some((issue) => issue.includes("invalid saved opening time")));
  assert.equal(
    validateWeeklySchedule(loaded.schedule).monday?.opensAt,
    "Choose an opening time.",
  );
});

test("legacy overnight hours are reported and must be corrected", () => {
  const loaded = scheduleFromOpeningHours([
    { day: "friday", opensAt: "22:00", closesAt: "02:00" },
  ]);

  assert.equal(loaded.hasUneditableEntries, false);
  assert.ok(loaded.issues.some((issue) => issue.includes("Overnight hours")));
  assert.equal(
    validateWeeklySchedule(loaded.schedule).friday?.closesAt,
    "Closing time must be after opening time.",
  );
});

test("duplicate saved days are reported as uneditable and only the first is shown", () => {
  const loaded = scheduleFromOpeningHours([
    { day: "monday", opensAt: "09:00", closesAt: "17:00" },
    { day: "monday", opensAt: "18:00", closesAt: "20:00" },
  ]);

  assert.equal(loaded.hasUneditableEntries, true);
  assert.equal(row(loaded.schedule, "monday").opensAt, "09:00");
  assert.equal(row(loaded.schedule, "monday").closesAt, "17:00");
  assert.ok(loaded.issues.some((issue) => issue.includes("more than one saved interval")));
});

test("serialized entries contain only the existing API fields", () => {
  const loaded = scheduleFromOpeningHours(weekdayHours);
  const serialized = openingHoursFromSchedule(loaded.schedule);

  assert.equal(serialized.length, weekdayHours.length);
  assert.deepEqual(
    Object.keys(serialized[0]).sort(),
    ["closesAt", "day", "opensAt"],
  );
});
