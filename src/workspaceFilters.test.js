import test from 'node:test';
import assert from 'node:assert/strict';
import { filterConversations, filterBookings } from './workspaceFilters.js';
test('inbox search includes saved replies and combines escalation filters without changing input', () => {
  const rows = [{id:1,customer_message:'Price?',ai_reply:'NGN 15000',escalated:false},{id:2,customer_message:'REFUND',escalated:true},{id:3}];
  assert.deepEqual(filterConversations(rows,'  refund  ','escalated'),[rows[1]]);
  assert.deepEqual(filterConversations(rows,'15000','all'),[rows[0]]);
  assert.deepEqual(filterConversations(rows,'refund','not-escalated'),[]);
  assert.equal(rows.length,3);
});
test('booking search preserves pending/canceled status and searches customer, contact, service and date', () => {
  const rows = [{customer_name:'Ada',customer_contact:'ada@shop.test',service:'Cut',booking_date:'2026-10-15',status:'pending'},{customer_name:'Ben',status:'canceled'}];
  for (const term of ['ada','shop.test','cut','2026-10']) assert.deepEqual(filterBookings(rows,term,'pending'),[rows[0]]);
  assert.deepEqual(filterBookings(rows,'','confirmed'),[]);
  assert.deepEqual(filterBookings(rows,'Ben','canceled'),[rows[1]]);
});
