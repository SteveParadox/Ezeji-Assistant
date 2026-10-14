import crypto from 'node:crypto';
import {assistantDatabaseRequest} from './assistantDatabaseRequest.js';
import {serviceDurationMinutes,validateBookingWindow} from './bookingValidation.js';
import { loadBusinessKnowledge } from './assistantKnowledge.js';
import { buildAssistantMessages } from './assistantPrompt.js';
import { bookingDialogue, selectedService } from './assistantBooking.js';
import { factualReply } from './assistantFacts.js';
import { policyIntent, validateAssistantOutput } from './assistantPolicy.js';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SESSION_TOKEN = /^[a-f0-9]{64}$/;
export const providerSafeContext = text => text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,'[customer email]').replace(/\+?\d[\d ()-]{7,}\d/g,'[customer phone]');
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const error = (message, status=503, code='ASSISTANT_UNAVAILABLE') => Object.assign(new Error(message),{status,code});
export function createAssistantService({ db, generate, knowledgeLoader=loadBusinessKnowledge, logger=console }) {
  async function rpc(name,args) {
    const result=await assistantDatabaseRequest(db.rpc(name,args));
    if(result.error) {
      const code=result.error.code;
      throw error(['42501','P0001'].includes(code)?'Assistant unavailable: paused, expired or allowance exhausted.':code==='P0004'?'Assistant is busy. Please retry shortly.':code==='P0006'?'A message is already processing in this conversation.':code==='23514'?'This request identifier belongs to a different message.':'Conversation service temporarily unavailable.',
        ['42501','P0001'].includes(code)?403:['P0004'].includes(code)?429:['P0006','P0007','23514'].includes(code)?409:503,code);
    }
    return result.data;
  }
  async function resolve({businessId,channel,sessionToken,identity}) {
    if(!UUID.test(businessId||'')) throw error('Invalid business identifier',400);
    const token=sessionToken || crypto.randomBytes(32).toString('hex');
    if(!SESSION_TOKEN.test(token)) throw error('Invalid conversation session',400);
    const identityHash=hash(`${channel}:${businessId}:${identity || token}`);
    const resolved=await rpc('resolve_assistant_thread',{p_business_id:businessId,p_channel:channel,p_identity_hash:identityHash});
    return {thread:Array.isArray(resolved)?resolved[0]:resolved,sessionToken:token};
  }
  async function history(thread,excludeRequestId) {
    let query=db.from('assistant_message_history').select('id,role,content,created_at,sequence,delivery_status,request_id,request_key').eq('business_id',thread.business_id).eq('thread_id',thread.id);
    const result=await assistantDatabaseRequest(query.order('sequence',{ascending:false}).limit(excludeRequestId?26:24));
    if(result.error)throw error('Conversation history unavailable');
    return (result.data||[]).filter(row=>!excludeRequestId||row.request_id!==excludeRequestId).slice(0,24).reverse();
  }
  async function durable(name,args) {
    // Database operations are idempotent; retry accepted checkpoints/commits, never generation.
    for(let attempt=0;attempt<3;attempt++) {
      try{return await rpc(name,args);}catch(e){if(attempt===2||e.status<500)throw e;}
    }
  }
  async function process({businessId,channel='web',sessionToken,identity,requestId,message,metadata={},signal,bookingSubmission,_snapshotAttempts=0}) {
    if(typeof message!=='string'||!message.trim()||message.length>2000) throw error('Enter a message of 2,000 characters or fewer.',400);
    if(typeof requestId!=='string'||requestId.length<12||requestId.length>120) throw error('A stable request identifier is required.',400);
    const {thread,sessionToken:token}=await resolve({businessId,channel,sessionToken,identity});
    const inputHash=hash(message.trim()+(bookingSubmission?JSON.stringify(bookingSubmission):''));
    if(bookingSubmission) {
      const previous=await db.from('assistant_requests').select('id,status,message_hash,outcome').eq('business_id',businessId).eq('thread_id',thread.id).eq('request_key',requestId).maybeSingle();
      if(previous.error)throw error('Booking replay lookup unavailable');
      if(previous.data?.status==='committed') {
        if(previous.data.message_hash!==inputHash)throw error('Booking request identifier payload changed.',409);
        return {...previous.data.outcome,sessionToken:token,conversationId:thread.id,requestId,correlationId:previous.data.id};
      }
    }
    const {profile,knowledge}=await knowledgeLoader(db,businessId);
    let controlled=policyIntent(message,knowledge,thread);
    if(!controlled&&/\b(?:booking status|my (?:booking|appointment)|status of (?:my |the )?(?:booking|appointment))\b/i.test(message)) {
      if(thread.latest_booking_id) {
        const booking=await db.from('bookings').select('id,status,booking_date,booking_time,business_timezone').eq('business_id',businessId).eq('id',thread.latest_booking_id).maybeSingle();
        if(booking.error)throw error('Booking status unavailable');
        controlled=booking.data?{intent:'BOOKING_STATUS',reply:`Your request ${booking.data.id} is ${booking.data.status}. ${booking.data.status==='pending'?'Staff confirmation is still required.':''}`}:{intent:'BOOKING_STATUS',reply:'No booking request is available for this conversation. Contact staff for help.'};
      }else controlled={intent:'BOOKING_STATUS',reply:'No submitted booking request belongs to this conversation. Contact staff if you booked using another channel.'};
    }
    if(bookingSubmission) {
      const op=bookingSubmission;
      const svc=knowledge.services.find(s=>s.id===op.serviceId);
      if(channel==='preview'||op.confirmed!==true||!svc||!['Professional','Business'].includes(profile.plan))throw error('Booking submission is unavailable.',403);
      if(typeof op.customerName!=='string'||op.customerName.trim().length<2||op.customerName.length>120||typeof op.customerContact!=='string'||op.customerContact.trim().length<5||op.customerContact.length>160)throw error('Valid customer name and contact are required.',422);
      let slot;try{slot=validateBookingWindow({startAt:op.startAt,durationMinutes:serviceDurationMinutes(svc.duration),timezone:profile.timezone,hoursJson:profile.hours_json});}catch(e){throw error(e.message,422);}
      controlled={reply:'Booking request awaiting submission.',bookingIntent:true,intent:'BOOKING_REQUEST',bookingDraft:null,bookingAction:{serviceId:svc.id,name:op.customerName.trim(),contact:op.customerContact.trim(),...slot}};
    }else controlled=controlled || bookingDialogue({message,knowledge,profile,thread});
    let claim;
    try{claim=await rpc('claim_assistant_request',{p_business_id:businessId,p_thread_id:thread.id,p_request_key:requestId,p_message:message.trim(),p_message_hash:inputHash,p_needs_model:!controlled,p_metadata:metadata,p_expected_revision:thread.revision});}
    catch(e){if(e.code==='P0007'&&_snapshotAttempts<2)return process({businessId,channel,sessionToken:token,identity,requestId,message,metadata,signal,bookingSubmission,_snapshotAttempts:_snapshotAttempts+1});throw e;}
    const req=claim.request;
    const wrap=result=>({...result,sessionToken:token,conversationId:thread.id,requestId,correlationId:req.id,preview:channel==='preview'});
    if(claim.state==='committed')return wrap(req.outcome);
    if(claim.state==='generated')return wrap(await durable('commit_assistant_reply',{p_request_id:req.id}));
    if(claim.state!=='claimed')throw error(claim.state==='review_required'?'The previous request could not be verified. Start a new conversation or contact staff.':'Your message is still processing. Retry this same message shortly.',409,claim.state);
    let generated=false;
    try {
      let outcome;
      if(controlled)outcome={...controlled,provider:'policy',escalated:channel==='preview'?false:!!controlled.escalated,previewHandoff:channel==='preview'&&!!controlled.escalated};
      else {
        const past=await history(thread,req.id);
        const messages=buildAssistantMessages({knowledge,history:past.map(m=>({role:m.role==='staff'?'assistant':m.role,content:providerSafeContext(m.content)})),message:providerSafeContext(message.trim()),maxBytes:28000});
        messages[0].content+='\nReturn only a JSON object with reply (plain text), intent (GREETING, BUSINESS_INFO, SERVICE_ENQUIRY, PRICING, HOURS, BOOKING_REQUEST, BOOKING_STATUS, CANCELLATION, COMPLAINT, HUMAN_HANDOFF, GENERAL_ENQUIRY or UNKNOWN), and needsHuman (boolean). This is text output, not a tool call.';
        const result=await generate({messages,correlationId:req.id,signal});
        const validated=validateAssistantOutput(result,knowledge);
        const booking=bookingDialogue({message,knowledge,profile,thread,intent:validated.intent});
        if(booking)Object.assign(validated,booking);
        else {const facts=factualReply({message,intent:validated.intent,knowledge,thread});if(facts)Object.assign(validated,facts);}
        outcome={...validated,provider:result.provider,usage:result.usage,model:result.model,latencyMs:result.latencyMs,attempts:result.attempts,estimatedCostUsd:result.estimatedCostUsd};
        if(validated.escalationSuggested&&!validated.grounded)outcome.escalationSuggested=false;
        if(validated.escalationSuggested&&channel!=='preview') {
          outcome.escalated=true;outcome.escalationReason='Assistant requested staff review';
          outcome.reply+=' Your enquiry has been recorded for staff review. Automated replies are paused.';
        }
      }
      if(channel==='preview'&&outcome.bookingAction) {delete outcome.bookingAction;outcome.reply='This preview collected booking details but did not submit a real booking. Customer requests require staff confirmation.';}
      outcome.serviceId=outcome.serviceId||selectedService(message,knowledge,thread)?.id;
      if(channel==='preview'&&controlled?.escalated)outcome.reply='In customer chat, this request would be recorded for staff review. This private preview has not notified staff or created a customer conversation.';
      // From this point a valid response exists: never release its reservation on a DB error.
      generated=true;
      const checkpoint=await durable('checkpoint_assistant_reply',{p_request_id:req.id,p_outcome:outcome,p_attempt:req.attempt});
      if(!checkpoint)throw error('Response recovery requires review');
      const committed=await durable('commit_assistant_reply',{p_request_id:req.id});
      logger.info?.('assistant.completed',{correlationId:req.id,channel,requestAttempt:req.attempt,provider:outcome.provider,latencyMs:outcome.latencyMs,grounded:outcome.grounded,usage:outcome.usage,attempts:outcome.attempts,estimatedCostUsd:outcome.estimatedCostUsd});
      return wrap(committed);
    } catch(e) {
      if(!generated) {
        await durable('fail_assistant_request',{p_request_id:req.id,p_code:e.code||'generation_failed',p_attempt:req.attempt}).catch(()=>logger.error?.('assistant.release_failed',{correlationId:req.id}));
      }
      logger.error?.('assistant.failed',{correlationId:req.id,code:e.code||'persistence_failure',requestAttempt:req.attempt,recoveryRequired:generated});
      throw error(generated?'Your reply is awaiting recovery. Retry the same message; no second AI request will be made.':'The assistant is temporarily unavailable. Your message remains in this conversation. Please retry or contact the business.',503,e.code||'ASSISTANT_UNAVAILABLE');
    }
  }
  return {process,resolve,history,rpc};
}
