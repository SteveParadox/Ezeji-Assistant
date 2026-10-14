import { hash } from './assistantService.js';
import { decryptToken } from './whatsappConnections.js';
import { claimQueuedOutbound } from './whatsappOutboxClaim.js';
export function messagingWindowOpen(event,now=Date.now()) {
  const occurred=Date.parse(event.message_occurred_at||'');
  return Number.isFinite(occurred)&&occurred<=now+300000&&now-occurred<24*60*60*1000;
}
export function createWhatsAppProcessor({db,assistant,fetchImpl=fetch,clock=Date.now,graphVersion=process.env.WHATSAPP_GRAPH_VERSION||'v23.0',tokenDecoder=decryptToken}) {
 if(!/^v\d{1,2}\.\d$/.test(graphVersion))throw new Error('Invalid WhatsApp Graph version');
 async function save(event,fields) {
   const result=await db.from('whatsapp_events').update({...fields,updated_at:new Date(clock()).toISOString()})
    .eq('id',event.id).eq('status','processing').eq('attempts',event.attempts).select('id').maybeSingle();
   if(result.error||result.data?.id!==event.id)throw new Error('Worker lease lost');
 }
 async function setOutbox(id,fields) {
   const row=await db.from('whatsapp_outbound_messages').update({...fields,updated_at:new Date(clock()).toISOString()}).eq('id',id).eq('status','sending').select('id').maybeSingle();
   if(row.error||row.data?.id!==id)throw new Error('Outbound persistence unavailable');
 }
 return async event=>{
   if(event.kind==='delivery_status') {
     const result=await db.rpc('apply_whatsapp_delivery_status',{p_business_id:event.business_id,p_message_id:event.receipt_message_id,p_status:event.receipt_status});
     if(result.error)throw new Error('Receipt reconciliation unavailable');
     await save(event,result.data===true?{status:'completed',lease_until:null}:{status:event.attempts>=5?'review_required':'queued',lease_until:null,next_attempt_at:new Date(clock()+90000).toISOString(),last_error:'Awaiting outbound provider ID'});
     return;
   }
   const [connection,profile,entitlement,existing]=await Promise.all([
     db.from('channel_connections').select('access_token').eq('business_id',event.business_id).eq('channel','whatsapp').eq('phone_number_id',event.phone_number_id).maybeSingle(),
     db.from('profiles').select('plan,assistant_active').eq('id',event.business_id).maybeSingle(),
     db.rpc('has_current_paid_entitlement',{p_business_id:event.business_id}),
     db.from('whatsapp_outbound_messages').select('id,status,provider_message_id,reply_text').eq('inbound_event_id',event.id).eq('business_id',event.business_id).maybeSingle(),
   ]);
   if(connection.error||profile.error||entitlement.error||existing.error)throw new Error('WhatsApp context unavailable');
   let outbound=existing.data;
   if(outbound?.provider_message_id){await save(event,{status:'completed',lease_until:null,provider_outbound_message_id:outbound.provider_message_id});return;}
   if(outbound&&outbound.status!=='queued') {await save(event,{status:'review_required',lease_until:null,last_error:'Outbound outcome requires review'});return;}
   if(!connection.data||!profile.data?.assistant_active||!['Professional','Business'].includes(profile.data.plan)||entitlement.data!==true) {
     await save(event,{status:'dead',lease_until:null,last_error:'Connection, activation or entitlement unavailable'});return;
   }
   if(!messagingWindowOpen(event,clock())) {
     // No approved template feature exists. Never send free-form text outside the service window.
     await save(event,{status:'review_required',lease_until:null,last_error:'Customer-service window closed or timestamp missing; approved template required'});return;
   }
   if(!outbound) {
     try {
       const outcome=await assistant.process({businessId:event.business_id,channel:'whatsapp',identity:`${event.phone_number_id}:${event.sender_phone}`,requestId:`wa:${hash(event.provider_event_id)}`,message:event.customer_text,
         metadata:{eventId:event.id,recipient:event.sender_phone}});
       if(outcome.suppressDelivery){await save(event,{status:'completed',lease_until:null,last_error:null});return;}
     } catch(e) {
       if(e.status===403) {await save(event,{status:'dead',lease_until:null,last_error:'Assistant entitlement unavailable'});return;}
       throw e;
     }
     const result=await db.from('whatsapp_outbound_messages').select('id,status,reply_text').eq('inbound_event_id',event.id).eq('business_id',event.business_id).maybeSingle();
     if(result.error||!result.data)throw new Error('Committed reply outbox unavailable');outbound=result.data;
   }
   // Decode before claiming: invalid credentials cannot leave a falsely ambiguous send.
   const token=tokenDecoder(connection.data.access_token);
   if(!await claimQueuedOutbound(db,outbound.id,()=>new Date(clock()))) {
     await save(event,{status:'review_required',lease_until:null,last_error:'Outbound already claimed'});return;
   }
   let accepted;
   try {
     const response=await fetchImpl(`https://graph.facebook.com/${graphVersion}/${event.phone_number_id}/messages`,{
       method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
       body:JSON.stringify({messaging_product:'whatsapp',to:event.sender_phone,type:'text',text:{body:outbound.reply_text}}),
     });
     const payload=await response.json();
     if(!response.ok||typeof payload.messages?.[0]?.id!=='string')throw new Error('Provider did not confirm acceptance');
     accepted=payload.messages[0].id;
     await setOutbox(outbound.id,{status:'accepted',provider_message_id:accepted});
   }catch{
     // HTTP timeouts/errors can be ambiguous. Never repeat a possibly accepted Meta send.
     await setOutbox(outbound.id,{status:'review_required',failure_reason:'Provider send outcome uncertain'}).catch(()=>{});
     await save(event,{status:'review_required',lease_until:null,last_error:'Outbound acceptance requires review'});return;
   }
   await save(event,{status:'completed',lease_until:null,provider_outbound_message_id:accepted,last_error:null});
 };
}
