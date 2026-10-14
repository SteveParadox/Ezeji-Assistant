import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClockTime, normalizeWorkingHours, validateWorkingHours, buildWeeklySchedule, summarizeWorkingHours } from "./workingHours.js";

test("old 12-hour schedules display correctly in time inputs", () => {
  assert.equal(normalizeClockTime("9:00 AM"), "09:00");
  assert.equal(normalizeClockTime("6:15 PM"), "18:15");
  assert.equal(normalizeClockTime("12:00 AM"), "00:00");
  assert.equal(normalizeClockTime("12:00 PM"), "12:00");
  assert.equal(normalizeWorkingHours([{ day: "Monday", open: "9:00 AM", close: "6:00 PM", closed: false }])[0].close, "18:00");
});
test("invalid operating hours do not pass save-time validation", () => {
  assert.match(validateWorkingHours([{ day: "Monday", open: "18:00", close: "09:00", closed: false }]), /after opening/);
  assert.match(validateWorkingHours([{ day: "Monday", open: "09:00", close: "09:00", closed: false }]), /after opening/);
  assert.equal(validateWorkingHours([{ day: "Sunday", open: "", close: "", closed: true }]), null);
});
test("hours summary includes only stored times and the declared timezone", () => {
  assert.equal(summarizeWorkingHours([{ day: "Monday", open: "09:00", close: "18:00", closed: false }], "Africa/Lagos"),
    "Monday: 09:00-18:00 (Africa/Lagos)");
});


test("brand-new businesses are not assigned fictional hours", () => {
  const schedule = normalizeWorkingHours([{ day: "Monday", open: "", close: "", closed: true }]);
  assert.equal(schedule[0].open, "");
  assert.equal(schedule[0].close, "");
  assert.match(validateWorkingHours([{ ...schedule[0], closed: false }]), /after opening/);
});


test("brand-new accounts with empty hours_json can configure every weekday", () => {
  const week = buildWeeklySchedule([]);
  assert.equal(week.length, 7);
  assert.deepEqual(week.map(row => row.day), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  assert.ok(week.every(row => row.closed && !row.open && !row.close));
  assert.equal(validateWorkingHours([{ ...week[0], closed: false, open: "10:00", close: "17:00" }, ...week.slice(1)]), null);
});
test("legacy partial weeks keep verified hours and gain blank closed days", () => {
  const week = buildWeeklySchedule([{day:"Friday",open:"9:00 AM",close:"5:00 PM",closed:false}]);
  assert.equal(week.length, 7);
  assert.deepEqual(week[4], {day:"Friday",open:"09:00",close:"17:00",closed:false});
  assert.equal(week[0].closed, true);
  assert.equal(week[0].open, "");
});
