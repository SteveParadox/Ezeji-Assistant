import crypto from 'node:crypto';
import { createAssistantService, UUID, SESSION_TOKEN, hash } from './assistantService.js';
import { createGroqClient } from './groqClient.js';
import { loadBusinessKnowledge, assistantReadiness } from './assistantKnowledge.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Assistant service temporarily unavailable.',code:e.code||'ASSISTANT_UNAVAILABLE'});}};
export async function assistantAuth(req,db,businessId,ownerOnly=false) {
  if(!db)throw fail(503,'Assistant database unavailable.');
  const bearer=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');
  if(!bearer)throw fail(401,'Sign in required.');
  const {data,error}=await db.auth.getUser(bearer[1]);
  if(error||!data?.user?.email_confirmed_at)throw fail(401,'A verified account is required.');
  if(data.user.id===businessId)return data.user;
  if(ownerOnly)throw fail(403,'Only the business owner can use this action.');
  const [membership,paid]=await Promise.all([
    db.from('business_staff_memberships').select('id,role').eq('business_id',businessId).eq('user_id',data.user.id).eq('status','active').maybeSingle(),
    db.rpc('has_active_premium_plan',{p_business_id:businessId}),
  ]);
  if(membership.error||paid.error)throw fail(503,'Access verification unavailable.');
  if(!membership.data||paid.data!==true)throw fail(403,'Business access denied.');
  return data.user;
}
export function attachAssistantRoutes(app,db,{generate=createGroqClient()}={}) {
  const service=createAssistantService({db,generate});
  const send=preview=>handle(async(req,res)=>{
    if(!db)throw fail(503,'Assistant database unavailable.');
    const b=req.body||{};
    if(!UUID.test(b.businessId||'')||!UUID.test(b.requestId||''))throw fail(400,'Valid business and request identifiers are required.');
    if(!preview){
      const clientHash=crypto.createHmac('sha256',process.env.ASSISTANT_CLIENT_HASH_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||'development-only').update(req.ip||'unknown').digest('hex');
      const rate=await service.rpc('check_assistant_client_rate',{p_client_hash:clientHash});
      if(!rate)throw fail(429,'Too many messages. Please wait a minute.');
    }
    const owner=preview?await assistantAuth(req,db,b.businessId,true):null;
    // A legacy client history/prompt can never enter the model context.
    const result=await service.process({businessId:b.businessId,channel:preview?'preview':'web',sessionToken:b.sessionToken,
      identity:preview?`${owner.id}:${b.sessionToken||''}`:undefined,requestId:b.requestId,message:b.message});
    // Correlation identifiers and public reply only; provider token/cost diagnostics stay server-side.
    const publicResult=Object.fromEntries(Object.entries(result).filter(([key])=>!['usage','model','latencyMs','attempts','estimatedCostUsd','bookingDraft','bookingAction'].includes(key)));
    return res.json(publicResult);
  });
  app.post('/assistant-reply',send(false));app.post('/assistant-preview',send(true));
  async function customerThread(req,preview=false) {
    if(!db)throw fail(503,'Conversation service unavailable.');
    const businessId=req.params.businessId;
    const token=req.headers['x-conversation-token'];
    if(!UUID.test(businessId||'')||!SESSION_TOKEN.test(token||''))throw fail(400,'Invalid conversation session.');
    const owner=preview?await assistantAuth(req,db,businessId,true):null;
    const channel=preview?'preview':'web';
    const identity=preview?`${owner.id}:${token}`:token;
    const lookup=await db.from('assistant_threads').select('id,business_id,channel,status,expires_at')
      .eq('business_id',businessId).eq('channel',channel).eq('identity_hash',hash(`${channel}:${businessId}:${identity}`)).maybeSingle();
    if(lookup.error)throw fail(503,'Conversation lookup unavailable.');
    if(!lookup.data||Date.parse(lookup.data.expires_at)<=Date.now())throw fail(404,'Conversation unavailable or expired.');
    return lookup.data;
  }
  for(const preview of [false,true]) {
    const path=preview?'/assistant-preview/session/:businessId':'/assistant-session/:businessId';
    app.get(path,handle(async(req,res)=>{const thread=await customerThread(req,preview);res.json({conversationId:thread.id,status:thread.status,messages:await service.history(thread)});}));
    app.delete(path,handle(async(req,res)=>{
      const thread=await customerThread(req,preview);
      const deleted=await service.rpc('delete_assistant_thread',{p_business_id:thread.business_id,p_thread_id:thread.id});
      if(deleted!==true)throw fail(503,'Deletion could not be verified.');
      res.json({deleted:true,notice:'Chat content deleted. Booking requests and usage accounting are retained separately.'});
    }));
  }
  app.get('/assistant-settings/:businessId',handle(async(req,res)=>{
    const businessId=req.params.businessId;await assistantAuth(req,db,businessId,true);
    const {profile,knowledge}=await loadBusinessKnowledge(db,businessId);
    res.json({active:profile.assistant_active,readiness:assistantReadiness(profile,knowledge.services),policies:knowledge.policies,languages:profile.language_preferences||''});
  }));
  app.patch('/assistant-settings/:businessId',handle(async(req,res)=>{
    const businessId=req.params.businessId;await assistantAuth(req,db,businessId,true);
    const b=req.body||{},patch={};
    if(typeof b.active==='boolean')patch.assistant_active=b.active;
    for(const [key,field] of [['booking','booking_policy'],['cancellation','cancellation_policy'],['refund','refund_policy'],['languages','language_preferences']]) {
      if(b[key]!==undefined) {
        if(typeof b[key]!=='string'||b[key].length>(key==='languages'?160:1500))throw fail(422,'Policy or language field is too long.');
        patch[field]=b[key].trim();
      }
    }
    if(!Object.keys(patch).length)throw fail(400,'No settings to update.');
    if(patch.assistant_active===true) {
      const {profile,knowledge}=await loadBusinessKnowledge(db,businessId);
      const readiness=assistantReadiness(profile,knowledge.services);
      if(!readiness.ready)throw fail(422,`Complete setup first: ${readiness.missing.join(', ')}.`);
    }
    const saved=await db.from('profiles').update(patch).eq('id',businessId).select('assistant_active,booking_policy,cancellation_policy,refund_policy,language_preferences').single();
    if(saved.error||!saved.data)throw fail(503,'Saved settings could not be verified.');
    res.json({saved:true,active:saved.data.assistant_active});
  }));
  app.get('/assistant-metrics/:businessId',handle(async(req,res)=>{const businessId=req.params.businessId;await assistantAuth(req,db,businessId);res.json(await service.rpc('assistant_owner_metrics',{p_business_id:businessId}));}));
  app.get('/assistant-inbox/:businessId',handle(async(req,res)=>{
    const businessId=req.params.businessId;await assistantAuth(req,db,businessId);
    const rows=await db.from('assistant_threads').select('id,channel,status,escalation_reason,created_at,updated_at')
      .eq('business_id',businessId).neq('channel','preview').order('updated_at',{ascending:false}).limit(50);
    if(rows.error)throw fail(503,'Inbox unavailable.');
    res.json({threads:rows.data||[]});
  }));
  app.get('/assistant-inbox/:businessId/:threadId',handle(async(req,res)=>{
    const {businessId,threadId}=req.params;await assistantAuth(req,db,businessId);
    const row=await db.from('assistant_threads').select('id,business_id,channel,status').eq('business_id',businessId).eq('id',threadId).neq('channel','preview').maybeSingle();
    if(row.error)throw fail(503,'Conversation unavailable.');if(!row.data)throw fail(404,'Conversation not found.');
    res.json({thread:row.data,messages:await service.history(row.data)});
  }));
  app.patch('/assistant-inbox/:businessId/:threadId',handle(async(req,res)=>{
    const {businessId,threadId}=req.params;const actor=await assistantAuth(req,db,businessId);
    if(!['human','automated','resolved'].includes(req.body?.status))throw fail(422,'Invalid handoff status.');
    const result=await service.rpc('set_assistant_handoff',{p_business_id:businessId,p_thread_id:threadId,p_actor_id:actor.id,p_status:req.body.status});
    res.json({status:result});
  }));
  return service;
}
