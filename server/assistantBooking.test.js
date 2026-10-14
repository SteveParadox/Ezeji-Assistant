import test from 'node:test';import assert from 'node:assert/strict';
import {localBookingInstant,parseBookingTime,bookingDialogue} from './assistantBooking.js';
import {factualReply} from './assistantFacts.js';
import {normalizeKnowledge,loadBusinessKnowledge} from './assistantKnowledge.js';
import {providerSafeContext} from './assistantService.js';
test('local times preserve Lagos offset and reject DST gaps and duplicate hours',()=>{
 assert.equal(localBookingInstant('2026-10-20','10:00','Africa/Lagos'),'2026-10-20T09:00:00.000Z');
 assert.throws(()=>localBookingInstant('2026-03-08','02:30','America/New_York'),/ambiguous|does not exist/);
 assert.throws(()=>localBookingInstant('2026-11-01','01:30','America/New_York'),/ambiguous/);
 assert.equal(parseBookingTime('tomorrow 9am','Africa/Lagos',Date.parse('2026-10-14T10:00:00Z')),'2026-10-15T08:00:00.000Z');
});
test('missing catalog, price and hours are unknown, not invented',()=>{
 const knowledge=normalizeKnowledge({business:'New shop'});
 const reply=factualReply({message:'How much and what are your hours?',knowledge,thread:{}}).reply;
 assert.match(reply,/No verified service pricing/);assert.match(reply,/No verified business hours/);
});
test('catalog has precedence over conflicting primary price; both questions use saved facts',()=>{
 const knowledge=normalizeKnowledge({business:'Salon',service_name:'Haircut',price:'NGN 99999',timezone:'Africa/Lagos',hours_json:[{day:'Monday',open:'09:00',close:'17:00',closed:false}]},[{id:'cut',name:'Haircut',price:'NGN 12000'}]);
 const reply=factualReply({message:'Haircut price and opening hours?',knowledge,thread:{}}).reply;
 assert.match(reply,/NGN 12000/);assert.doesNotMatch(reply,/99999/);assert.match(reply,/09:00/);
});
test('booking collection does not treat unverified contact text as cross-channel identity',()=>{
 const k=normalizeKnowledge({plan:'Professional',timezone:'Africa/Lagos'},[{id:'cut',name:'Haircut',duration:'30 mins'}]);
 const result=bookingDialogue({message:'Book Haircut',knowledge:k,profile:{plan:'Professional'},thread:{status:'automated'}});
 assert.equal(result.bookingDraft.contact,undefined);assert.match(result.reply,/date and time/);
 assert.equal(providerSafeContext('Email me at ada@example.test, +2348000000000'),'Email me at [customer email] [customer phone]');
});
test('knowledge is loaded on every call so edited/deleted FAQs cannot remain cached',async()=>{
 let answer='Old answer';const db={from(table){return {select(){return this;},eq(){return this;},order(){return this;},maybeSingle:async()=>({data:{id:'b',business:'Shop'}}),limit:async()=>({data:table==='faqs'&&answer?[{question:'Q',answer}]:[]})};}};
 assert.equal((await loadBusinessKnowledge(db,'b')).knowledge.faqs[0].answer,'Old answer');answer='Updated';assert.equal((await loadBusinessKnowledge(db,'b')).knowledge.faqs[0].answer,'Updated');answer=null;assert.equal((await loadBusinessKnowledge(db,'b')).knowledge.faqs.length,0);
});
