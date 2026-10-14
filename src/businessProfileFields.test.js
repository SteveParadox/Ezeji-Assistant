import test from "node:test";
import assert from "node:assert/strict";
import {buildBusinessProfileUpdate} from "./businessProfileFields.js";
test("profile save never invents salon data, default prices or opening hours",()=>{
 const result=buildBusinessProfileUpdate({name:"Real Business",category:"Other"},{
   id:"user-1",email:"owner@example.test",
 });
 assert.equal(result.business,"Real Business");
 assert.equal(result.price,"");
 assert.equal(result.hours,"");
 assert.equal(result.phone,"");
 assert.equal(result.website,"");
 assert.equal(result.email,"owner@example.test");
});
test("public email, website, phone persist separately from login identity",()=>{
 const result=buildBusinessProfileUpdate({
  name:"  Cafe  ",category:"Restaurant",email:"  INFO@CAFE.TEST  ",
  website:"https://cafe.test",phone:"+2348000000000",
 },{id:"owner",email:"login@example.test"});
 assert.equal(result.business,"Cafe");
 assert.equal(result.contactEmail,"info@cafe.test");
 assert.equal(result.email,"login@example.test");
 assert.equal(result.website,"https://cafe.test");
});
test("invalid names and contact email do not create misleading success",()=>{
 assert.throws(()=>buildBusinessProfileUpdate({name:"a"}),/business name/);
 assert.throws(()=>buildBusinessProfileUpdate({name:"Cafe",email:"not an email"}),/contact email/);
});


test("profile edits cannot overwrite verified opening hours from the weekly schedule", () => {
  const profile = {
    id: "owner-1",
    business: "Salon",
    hours: "Monday: 10:00-18:00 (Africa/Lagos)",
    hoursJson: [{ day: "Monday", open: "10:00", close: "18:00", closed: false }],
  };
  const update = buildBusinessProfileUpdate({
    name: "Salon Updated", category: "Salon & Beauty",
    hours: "24/7", description: "Real treatments",
  }, profile);
  assert.equal(update.hours, profile.hours);
  assert.deepEqual(update.hoursJson, profile.hoursJson);
  assert.equal(update.business, "Salon Updated");
});
