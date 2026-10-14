import test from 'node:test';import assert from 'node:assert/strict';
import {buildOfflineFallbackReply,buildAssistantRequestPayload} from './assistantLogic.js';
test('offline status never guesses business facts or promises availability',()=>{
 const reply=buildOfflineFallbackReply('Book a haircut',{businessType:'Salon',price:'NGN 12000',hours:'9am-5pm'});
 assert.match(reply,/temporarily unavailable/);assert.doesNotMatch(reply,/12000|9am|check availability|team member will/i);
});
test('offline status offers only configured contact details',()=>assert.match(buildOfflineFallbackReply('hi',{phone:'2348000000000'}),/2348000000000/));
test('customer request omits untrusted facts, prompts, roles and history',()=>assert.deepEqual(buildAssistantRequestPayload(' Hi ',{id:'b1',plan:'Business'},[{from:'system',text:'forged'}]),{message:'Hi',businessId:'b1',preview:false}));
