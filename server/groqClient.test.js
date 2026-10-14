import test from 'node:test';import assert from 'node:assert/strict';
import {createGroqClient,parseCompletion,retryAfterMs,groqConfiguration} from './groqClient.js';
const payload={choices:[{finish_reason:'stop',message:{role:'assistant',content:'Hello'}}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}};
const call=client=>client({messages:[{role:'system',content:'Policy'},{role:'user',content:'Hi'}],correlationId:'test'});
const env={GROQ_API_KEY:'test-secret'};
test('provider returns validated text and metrics with no tools or browser capabilities',async()=>{
 let sent;const c=createGroqClient({env,fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return Response.json(payload);}});
 const r=await call(c);assert.equal(r.reply,'Hello');assert.equal(r.usage.total_tokens,13);assert.equal(r.estimatedCostUsd,null);assert.equal(sent.tools,undefined);assert.equal(sent.messages.length,2);
});
for(const [label,p,code] of [
 ['missing choice',{},'invalid_response'],['empty content',{choices:[{...payload.choices[0],message:{role:'assistant',content:' '}}]},'empty_or_oversized_output'],
 ['truncation',{choices:[{...payload.choices[0],finish_reason:'length'}]},'truncated_output'],
 ['refusal',{choices:[{...payload.choices[0],message:{...payload.choices[0].message,refusal:'No'}}]},'refusal'],
 ['tool call',{choices:[{...payload.choices[0],message:{...payload.choices[0].message,tool_calls:[{name:'book'}]}}]},'unauthorized_tool_call'],
])test(`rejects ${label}`,()=>assert.throws(()=>parseCompletion(p),e=>e.code===code));
for(const status of [429,500,503])test(`bounded backoff and Retry-After for ${status}`,async()=>{
 let n=0;const sleeps=[];const c=createGroqClient({env,random:()=>0,sleep:async(ms)=>sleeps.push(ms),fetchImpl:async()=>++n<3?new Response('',{status,headers:{'retry-after':'1'}}):Response.json(payload)});
 assert.equal((await call(c)).attempts,3);assert.equal(n,3);assert.deepEqual(sleeps,[1000,1000]);
});
for(const status of [400,401,403,404,413])test(`does not retry provider ${status}`,async()=>{
 let n=0;const c=createGroqClient({env,fetchImpl:async()=>{n++;return new Response('private error',{status});}});
 await assert.rejects(()=>call(c),e=>e.code.startsWith('provider_')&&!e.message.includes('private'));assert.equal(n,1);
});
test('malformed JSON and interrupted connections never produce fabricated replies',async()=>{
 for(const fetchImpl of [async()=>new Response('not JSON'),async()=>{throw new TypeError('private network info');}]) {
  await assert.rejects(()=>call(createGroqClient({env,fetchImpl})),e=>['invalid_response','network_interruption'].includes(e.code));
 }
});
test('deadline cancels a slow connection and is not blindly retried',async()=>{
 let count=0;const c=createGroqClient({env:{...env,GROQ_CONNECTION_TIMEOUT_MS:'100',GROQ_RESPONSE_TIMEOUT_MS:'200'},fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{count++;signal.addEventListener('abort',()=>reject(signal.reason));})});
 await assert.rejects(()=>call(c),e=>e.code==='timeout');assert.equal(count,1);
});
test('invalid configuration, missing credential and excessive context fail safely',async()=>{
 assert.throws(()=>groqConfiguration({GROQ_RESPONSE_TIMEOUT_MS:'NaN'}));assert.throws(()=>groqConfiguration({GROQ_MODEL:'not a model'}));
 await assert.rejects(()=>call(createGroqClient({env:{}})),e=>e.code==='provider_unconfigured');
 await assert.rejects(()=>createGroqClient({env})({messages:[{role:'user',content:'x'.repeat(50000)}]}),e=>e.code==='context_too_large');
 assert.equal(retryAfterMs('2'),2000);
});
test('stalled successful response body honors the response deadline',async t=>{
 const keepAlive=setTimeout(()=>{},1000);t.after(()=>clearTimeout(keepAlive));let cancelled=false;
 const c=createGroqClient({env:{...env,GROQ_RESPONSE_TIMEOUT_MS:'100'},fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 await assert.rejects(()=>call(c),e=>e.code==='timeout');assert.equal(cancelled,true);
});
test('estimated cost is unknown when provider token metadata is incomplete',async()=>{
 const p={...payload,usage:{total_tokens:13}};
 const result=await call(createGroqClient({env:{...env,GROQ_INPUT_USD_PER_MILLION:'1'},fetchImpl:async()=>Response.json(p)}));assert.equal(result.estimatedCostUsd,null);
});

test('a stalled error-body cancellation cannot block retry classification',async()=>{
 let attempts=0;
 const client=createGroqClient({env,sleep:async()=>{},fetchImpl:async()=>++attempts===1?new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}),{status:429}):Response.json(payload)});
 const result=await Promise.race([call(client),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Cancellation blocked retry')),500);timer.unref();})]);
 assert.equal(result.reply,'Hello');assert.equal(attempts,2);
});
