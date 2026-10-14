import test from "node:test";
import assert from "node:assert/strict";
import {serviceDurationMinutes,validateBookingWindow} from "./bookingValidation.js";
const hours=[{day:"Tuesday",open:"09:00",close:"17:00",closed:false}];
test("booking duration is explicit; no invented fallback",()=>{
 assert.equal(serviceDurationMinutes("45 mins"),45);
 assert.equal(serviceDurationMinutes("1 hour"),60);
 assert.equal(serviceDurationMinutes("sometime"),null);
});
test("timezone conversion respects Africa/Lagos business hours",()=>{
 const value=validateBookingWindow({
  startAt:"2026-10-20T10:00:00Z",durationMinutes:60,
  timezone:"Africa/Lagos",hoursJson:hours,now:Date.parse("2026-10-13T12:00:00Z"),
 });
 assert.equal(value.localTime,"11:00");
 assert.equal(value.localDate,"2026-10-20");
});
test("requests outside stored hours are rejected",()=>{
 assert.throws(()=>validateBookingWindow({
  startAt:"2026-10-20T05:00:00Z",durationMinutes:60,timezone:"Africa/Lagos",
  hoursJson:hours,now:Date.parse("2026-10-13T12:00:00Z"),
 }),/outside business hours/);
});
test("invalid timezone and unconfigured hours fail closed",()=>{
 assert.throws(()=>validateBookingWindow({
  startAt:"2026-10-20T10:00:00Z",durationMinutes:60,timezone:"Not/AZone",
  hoursJson:hours,now:Date.parse("2026-10-13T12:00:00Z"),
 }),/timezone/);
 assert.throws(()=>validateBookingWindow({
  startAt:"2026-10-20T10:00:00Z",durationMinutes:60,timezone:"Africa/Lagos",
  hoursJson:[],now:Date.parse("2026-10-13T12:00:00Z"),
 }),/hours/);
});
test('booking dates require explicit timezone, whole minutes and real calendar dates',()=>{
 for(const startAt of ['2026-10-20T10:00:00','2026-10-20T10:00:31Z','2026-02-30T10:00:00Z'])assert.throws(()=>validateBookingWindow({startAt,durationMinutes:30,timezone:'Africa/Lagos',hoursJson:hours,now:Date.parse('2026-01-01T00:00:00Z')}));
});
