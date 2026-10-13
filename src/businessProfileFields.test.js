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
