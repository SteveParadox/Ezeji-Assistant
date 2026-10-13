import dotenv from "dotenv";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { decryptToken } from "../server/whatsappConnections.js";

dotenv.config();
for (const name of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","WHATSAPP_TOKEN_ENCRYPTION_KEY","GROQ_API_KEY"]) {
  if (!process.env[name]) throw new Error(`Missing WhatsApp worker setting: ${name}`);
}
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false},
});
let running=true;
process.on("SIGTERM",()=>{running=false});
process.on("SIGINT",()=>{running=false});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function saveEvent(event, fields) {
  const {error}=await db.from("whatsapp_events").update({...fields,updated_at:new Date().toISOString()})
    .eq("id",event.id).eq("status","processing");
  if(error)throw error;
}

async function processEvent(event) {
  // Only DB-leased records can be processed. A previous ambiguous send may
  // require human review; never blindly repeat such a send.
  const {data:outbound,error:outError}=await db.from("whatsapp_outbound_messages")
    .select("id,status,provider_message_id").eq("inbound_event_id",event.id).maybeSingle();
  if(outError)throw outError;
  if(outbound?.status==="sending"||outbound?.status==="review_required") {
    await saveEvent(event,{status:"review_required",lease_until:null,last_error:"Previous outbound status is uncertain"});
    return;
  }
  if(outbound?.provider_message_id) {
    await saveEvent(event,{status:"completed",lease_until:null,provider_outbound_message_id:outbound.provider_message_id});
    return;
  }
  const {data:valid,error:entitlementError}=await db.rpc("has_current_paid_entitlement",{p_business_id:event.business_id});
  if(entitlementError)throw entitlementError;
  if(valid!==true) {
    await saveEvent(event,{status:"dead",lease_until:null,last_error:"Subscription expired"});
    return;
  }
  const {data:profile,error:profileError}=await db.from("profiles")
    .select("business,hours,description,plan").eq("id",event.business_id).maybeSingle();
  if(profileError||!profile)throw profileError || new Error("Business unavailable");
  if(!["Professional","Business"].includes(profile.plan)) {
    await saveEvent(event,{status:"dead",lease_until:null,last_error:"Plan does not include WhatsApp"});
    return;
  }
  const {data:conn,error:connError}=await db.from("channel_connections")
    .select("access_token").eq("business_id",event.business_id).eq("channel","whatsapp")
    .eq("phone_number_id",event.phone_number_id).maybeSingle();
  if(connError||!conn)throw connError || new Error("WhatsApp connection missing");
  const {data:reservation,error:reserveError}=await db.rpc("reserve_ai_usage",{
    p_business_id:event.business_id,
    p_period_key:new Date().toISOString().slice(0,7),
    p_idempotency_key:"wa:"+event.provider_event_id,
  });
  if(reserveError){
    // For quota denial do not retry indefinitely and burn Meta/Groq resources.
    if(reserveError.code==="P0001"||reserveError.code==="42501"){
      await saveEvent(event,{status:"dead",lease_until:null,last_error:"AI quota unavailable"});
      return;
    }
    throw reserveError;
  }
  let finished=false;
  try {
    const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.GROQ_API_KEY},
      signal:AbortSignal.timeout(15000),
      body:JSON.stringify({
        model:process.env.GROQ_MODEL||"openai/gpt-oss-20b",
        max_tokens:Math.min(1000,Number(process.env.GROQ_MAX_REPLY_TOKENS)||500),
        messages:[
          {role:"system",content:`You are a concierge for ${profile.business}. Be concise.
Never confirm a booking without a committed booking record. No availability data is guaranteed.
Hours: ${profile.hours||"unknown"}. About: ${profile.description||""}`},
          {role:"user",content:event.customer_text||""},
        ],
      }),
    });
    if(!response.ok)throw new Error("Groq request failed");
    const ai=await response.json();
    const reply=String(ai.choices?.[0]?.message?.content||"A team member will follow up.").slice(0,4000);
    const {data:out,error:outWriteError}=await db.from("whatsapp_outbound_messages")
      .upsert({inbound_event_id:event.id,business_id:event.business_id,
        recipient_phone:event.sender_phone,reply_text:reply,status:"queued"},
      {onConflict:"inbound_event_id",ignoreDuplicates:true})
      .select("id,status,provider_message_id").maybeSingle();
    if(outWriteError)throw outWriteError;
    const {error:chargeError}=await db.rpc("finalize_ai_usage",{p_reservation_id:reservation,p_success:true});
    if(chargeError)throw chargeError;
    finished=true;

    const {data:latest,error:latestError}=await db.from("whatsapp_outbound_messages")
      .select("id,status,provider_message_id").eq("inbound_event_id",event.id).single();
    if(latestError)throw latestError;
    if(latest.status!=="queued") {
      await saveEvent(event,{status:"review_required",lease_until:null,last_error:"Outbound delivery state requires inspection"});
      return;
    }
    const {error:sendingError}=await db.from("whatsapp_outbound_messages")
      .update({status:"sending",updated_at:new Date().toISOString()})
      .eq("id",latest.id).eq("status","queued");
    if(sendingError)throw sendingError;
    // From this point, even a timeout is ambiguous. Mark review_required on
    // uncertainty so retries never send duplicate customer messages.
    let provider;
    try {
      const sent=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION||"v23.0"}/${event.phone_number_id}/messages`,{
        method:"POST",
        signal:AbortSignal.timeout(15000),
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+decryptToken(conn.access_token)},
        body:JSON.stringify({messaging_product:"whatsapp",to:event.sender_phone,text:{body:reply}}),
      });
      provider=await sent.json().catch(()=>({}));
      if(!sent.ok)throw new Error("Meta rejected outbound request: "+sent.status);
      if(typeof provider.messages?.[0]?.id!=="string")throw new Error("Meta acknowledgement missing message ID");
    }catch(error) {
      await db.from("whatsapp_outbound_messages").update({
        status:"review_required",failure_reason:"Provider delivery result uncertain",
        updated_at:new Date().toISOString(),
      }).eq("id",latest.id);
      await saveEvent(event,{status:"review_required",lease_until:null,last_error:"Outbound delivery requires manual review"});
      return;
    }
    const messageId=provider.messages[0].id;
    const {error:savedError}=await db.from("whatsapp_outbound_messages")
      .update({status:"accepted",provider_message_id:messageId,updated_at:new Date().toISOString()})
      .eq("id",latest.id);
    if(savedError)throw savedError;
    const {error:conversationError}=await db.from("conversations").insert({
      business_id:event.business_id,customer_message:event.customer_text,
      ai_reply:reply,escalated:false,booking_intent:/book|reserve|appointment/i.test(event.customer_text||""),
    });
    if(conversationError)console.error("WhatsApp conversation persistence failed",conversationError.message);
    await saveEvent(event,{status:"completed",lease_until:null,provider_outbound_message_id:messageId});
  } finally {
    if(!finished) {
      const {error:released}=await db.rpc("finalize_ai_usage",{
        p_reservation_id:reservation,p_success:false,
      });
      if(released)console.error("Unable to release usage reservation",released.message);
    }
  }
}

async function tick() {
  const {data:events,error}=await db.rpc("claim_whatsapp_events",{p_limit:5});
  if(error)throw error;
  for(const event of events||[]) {
    try { await processEvent(event); }
    catch(error) {
      const retry=event.attempts<5;
      const delay=Math.min(3600_000,30000*2**Math.min(5,event.attempts));
      await saveEvent(event,{
        status:retry?"queued":"dead",lease_until:null,
        next_attempt_at:new Date(Date.now()+delay).toISOString(),
        last_error:"Worker retry required",
      });
      console.error(JSON.stringify({event:"whatsapp_processing_error",attempts:event.attempts,retry,reason:error.message}));
    }
  }
}

while(running) {
  try{await tick()}catch(error){console.error("WhatsApp worker polling failed",error.message)}
  if(running)await sleep(2500);
}
