import test from 'node:test';import assert from 'node:assert/strict';
import {attachAssistantRoutes} from './assistantRoutes.js';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function setup(owner=id){const handlers=new Map();let reads=0;
 const db={auth:{getUser:async()=>({data:{user:{id:owner,email_confirmed_at:'2026-10-01'}}})},from(){reads++;throw new Error('Unauthorized data access');}};
 const app={};for(const verb of ['post','get','patch','delete'])app[verb]=(path,fn)=>handlers.set(`${verb}:${path}`,fn);
 attachAssistantRoutes(app,db,{generate:async()=>{throw new Error('Unauthorized provider call');}});
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};
 return {handlers,res,reads:()=>reads};}
test('preview requires authenticated owner before loading saved facts',async()=>{
 const {handlers,res,reads}=setup();await handlers.get('post:/assistant-preview')({headers:{},body:{businessId:id,requestId:other,message:'Hi'}},res);
 assert.equal(res.statusCode,401);assert.equal(reads(),0);
});
test('preview rejects cross-business impersonation before tenant lookup',async()=>{
 const {handlers,res,reads}=setup(other);await handlers.get('post:/assistant-preview')({headers:{authorization:'Bearer test'},body:{businessId:id,requestId:other,message:'Hi'}},res);
 assert.equal(res.statusCode,403);assert.equal(reads(),0);
});
test('customer history lookup requires a high-entropy capability, never a conversation ID alone',async()=>{
 const {handlers,res,reads}=setup();await handlers.get('get:/assistant-session/:businessId')({headers:{'x-conversation-token':id},params:{businessId:id}},res);
 assert.equal(res.statusCode,400);assert.equal(reads(),0);
});
