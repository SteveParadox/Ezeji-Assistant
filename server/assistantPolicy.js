// Deterministic policy signals supplement (never authorize through) LLM intent.
export const INTENTS = new Set(['GREETING','BUSINESS_INFO','SERVICE_ENQUIRY','PRICING','HOURS','BOOKING_REQUEST','BOOKING_STATUS','CANCELLATION','COMPLAINT','HUMAN_HANDOFF','GENERAL_ENQUIRY','UNKNOWN']);
export function policyIntent(message, knowledge, thread) {
  const lower = message.trim().toLowerCase();
  if (thread.channel === 'whatsapp' && /^(stop|unsubscribe|opt out)$/.test(lower)) return { intent:'HUMAN_HANDOFF', reply:'Automated replies for this conversation are now stopped. Send START to opt back in.', conversationStatus:'opted_out' };
  if (thread.status === 'opted_out') return /^(start|subscribe|opt in)$/.test(lower)
    ? {intent:'GREETING',reply:'Automated replies are enabled again. How can I help?',conversationStatus:'automated'}
    : {intent:'HUMAN_HANDOFF',reply:'Automated replies are stopped. Send START if you want to enable them again.',suppressDelivery:true};
  if (thread.status === 'human') return {intent:'HUMAN_HANDOFF',reply:'This conversation is awaiting staff review. Automated answers are paused; staff response timing is not guaranteed.'};
  const configured = String(knowledge.style?.escalationTopics || '').split(',').map(x=>x.trim().toLowerCase()).filter(x=>x.length>=3);
  if (/\b(human|real person|speak (to|with) (someone|staff|a person)|staff please|customer support|complaint|complain|refund|charged twice|payment issue)\b/i.test(message) || configured.some(x=>lower.includes(x))) {
    return {intent: /complain|refund|payment|charged/i.test(message)?'COMPLAINT':'HUMAN_HANDOFF',reply:'Your request for staff review has been recorded in this conversation. Automated replies are paused. Staff response timing is not guaranteed.', escalated:true, escalationReason: /complain|refund|payment|charged/i.test(message)?'Complaint or sensitive payment enquiry':'Customer requested staff'};
  }
  return null;
}
export function validateAssistantOutput(generation, knowledge) {
  // A text-only JSON contract does not depend on optional model tool/JSON modes.
  // Consequential actions remain impossible regardless of model intent.
  let result;
  try { result=JSON.parse(generation.reply); } catch { throw Object.assign(new Error('Invalid assistant output'),{code:'invalid_assistant_contract'}); }
  if (!result || typeof result.reply!=='string' || !result.reply.trim() || result.reply.length>6000 || !INTENTS.has(result.intent)) throw Object.assign(new Error('Invalid assistant output'),{code:'invalid_assistant_contract'});
  let reply=result.reply.trim(); let grounded=true;
  const facts=JSON.stringify(knowledge).toLowerCase();
  const amounts=reply.match(/(?:₦|\$|€|£|NGN|USD|GBP|EUR)\s*[\d,]+(?:\.\d+)?/gi)||[];
  if (amounts.some(amount=>!facts.includes(amount.toLowerCase()))) grounded=false;
  // Reject false action assurances. Model output can never acknowledge a side effect.
  if (/\b(?:i(?:'ve| have)|we(?:'ve| have)|your (?:booking|appointment|payment|refund)(?: is| has been)?)\s*(?:successfully\s*)?(?:booked|reserved|confirmed|processed|refunded|notified|submitted|saved|cancelled|canceled|sent)\b/i.test(reply)) grounded=false;
  const times=reply.match(/\b\d{1,2}:\d{2}\b/g)||[];
  if(times.some(time=>!facts.includes(time))) grounded=false;
  if (/\b(?:slots? (?:is|are) available|availability (?:is )?confirmed|guaranteed (?:booking|refund)|in stock|discount of)\b/i.test(reply)) grounded=false;
  if (/<(?:script|iframe|img)|javascript:/i.test(reply)) grounded=false;
  if(!grounded) reply='I cannot verify that answer from the saved business information. Please contact staff for clarification; no booking or payment has been confirmed.';
  return {reply,intent:result.intent,bookingIntent:result.intent==='BOOKING_REQUEST',grounded,
    escalationSuggested:result.intent==='COMPLAINT'||result.intent==='HUMAN_HANDOFF'||result.needsHuman===true};
}
