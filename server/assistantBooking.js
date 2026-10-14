import {businessLocalTime,serviceDurationMinutes,validateBookingWindow} from './bookingValidation.js';
// Resolve a local wall clock by finding matching instants. Ambiguous/nonexistent DST
// times must be clarified; silently selecting an offset can book the wrong hour.
export function localBookingInstant(date,time,timezone) {
 const base=Date.parse(`${date}T${time}:00Z`);if(!Number.isFinite(base))throw new Error('Invalid date or time.');
 const candidates=[];
 for(let offset=-14*60;offset<=14*60;offset+=15) {
  const instant=new Date(base+offset*60000),local=businessLocalTime(instant,timezone);
  if(local.date===date&&local.time===time)candidates.push(instant.toISOString());
 }
 if(candidates.length!==1)throw new Error('That local time is ambiguous or does not exist. Choose another time.');
 return candidates[0];
}
export function parseBookingTime(message,timezone,now=Date.now()) {
 const explicit=/\b(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\b/.exec(message);
 if(explicit)return localBookingInstant(explicit[1],explicit[2].padStart(5,'0'),timezone);
 const relative=/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(message);
 const clock=/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(message);
 if(!relative||!clock)return null;
 let hh=Number(clock[1]),mm=Number(clock[2]||0);if(hh<1||hh>12||mm>59)throw new Error('Invalid appointment time.');hh=hh%12+(clock[3].toLowerCase()==='pm'?12:0);
 const local=businessLocalTime(new Date(now),timezone);const day=new Date(`${local.date}T12:00:00Z`);
 const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];let add=0;
 if(relative[1].toLowerCase()==='tomorrow')add=1;
 else if(relative[1].toLowerCase()!=='today')add=(weekdays.indexOf(relative[1].toLowerCase())-day.getUTCDay()+7)%7||7;
 day.setUTCDate(day.getUTCDate()+add);
 return localBookingInstant(day.toISOString().slice(0,10),`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`,timezone);
}
export function selectedService(message,knowledge,thread) {
 const matches=knowledge.services.filter(s=>s.name&&message.toLowerCase().includes(s.name.toLowerCase())).sort((a,b)=>b.name.length-a.name.length);
 return matches[0]||knowledge.services.find(s=>s.id===thread.service_context_id);
}
const reviewKey=r=>r?JSON.stringify([r.serviceName,r.price,r.duration,r.name,r.contact,r.slot?.start,r.slot?.end,r.slot?.localDate,r.slot?.localTime,r.slot?.timezone]):null;
export function bookingDialogue({message,knowledge,profile,thread,intent,now=Date.now()}) {
 const prior=thread.booking_draft;
 if(!prior&&intent!=='BOOKING_REQUEST'&&!/\b(book|appointment|reserve|reservation)\b/i.test(message))return null;
 if(thread.status==='human'||thread.status==='opted_out')return null;
 if(/^cancel(?: request| booking draft)?$/i.test(message.trim()))return {reply:'The unfinished booking request has been cleared. No appointment was canceled.',bookingDraft:null,intent:'BOOKING_REQUEST'};
 if(!['Professional','Business'].includes(profile.plan))return {reply:'Online booking requests require an eligible business plan. Please contact staff to request an appointment.',intent:'BOOKING_REQUEST',bookingDraft:null};
 // Questions about saved facts must not be captured as a customer name/contact.
 if(prior&&/\b(how much|what(?:'s| is) (?:the )?price|opening hours|what.*hours|when.*open)\b/i.test(message))return null;
 const draft=structuredClone(prior||{});
 const change=/^(service|date|name|contact):\s*(.+)$/i.exec(message.trim());
 if(change) {
   const field=change[1].toLowerCase(),value=change[2].trim();
   if(field==='service') {const svc=selectedService(value,knowledge,{});if(!svc)return {reply:'That service is not in the saved catalog. Which listed service would you like?',bookingDraft:draft,intent:'BOOKING_REQUEST'};draft.serviceId=svc.id;}
   if(field==='date') {try{draft.startAt=parseBookingTime(value,knowledge.timezone,now);delete draft.slot;}catch{draft.startAt=null;}}
   if(field==='name') {if(value.length<2||value.length>120)return {reply:'Please enter a name of 2 to 120 characters.',bookingDraft:draft,intent:'BOOKING_REQUEST'};draft.name=value;}
   if(field==='contact') {if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&!/^\+?[\d\s()-]{8,25}$/.test(value))return {reply:'Please provide a valid email or telephone number.',bookingDraft:draft,intent:'BOOKING_REQUEST'};draft.contact=value;}
 }
 if(!draft.serviceId)draft.serviceId=selectedService(message,knowledge,thread)?.id;
 const service=knowledge.services.find(s=>s.id===draft.serviceId);
 const result=(reply)=>({reply,bookingDraft:draft,intent:'BOOKING_REQUEST',bookingIntent:true,serviceId:service?.id});
 if(!service)return result(`Which service would you like to request? ${knowledge.services.map(s=>s.name).join(', ')||'Please contact staff; no bookable services are configured.'}`);
 if(!serviceDurationMinutes(service.duration))return {...result('Staff must configure the service duration before a booking can be requested. Please contact the business.'),bookingDraft:null};
 try {
  if(!draft.startAt)draft.startAt=parseBookingTime(message,knowledge.timezone,now);
  if(!draft.startAt)return result(`What date and time would you prefer for ${service.name}? Use YYYY-MM-DD HH:mm in ${knowledge.timezone}, or e.g. Friday 9am.`);
  draft.slot=validateBookingWindow({startAt:draft.startAt,durationMinutes:serviceDurationMinutes(service.duration),timezone:knowledge.timezone,hoursJson:profile.hours_json,now});
 }catch(e){delete draft.startAt;delete draft.slot;return result(`${e.message} Please provide another date and time in ${knowledge.timezone}.`);}
 if(!draft.name) {
  if(prior?.step==='name'&&message.trim().length>=2&&message.length<=120)draft.name=message.trim();
  else{draft.step='name';return result('What name should staff use for this booking request?');}
 }
 if(!draft.contact) {
  const contact=message.trim();
  if(prior?.step==='contact'&&contact.length<=160&&(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)||/^\+?[\d\s()-]{8,25}$/.test(contact)))draft.contact=contact;
  else{draft.step='contact';return result('What email address or phone number should staff use to contact you?');}
 }
 const review={serviceName:service.name,price:service.price||'',duration:service.duration,slot:draft.slot,name:draft.name,contact:draft.contact};
 if(prior?.step==='confirm'&&/^confirm$/i.test(message.trim())&&reviewKey(prior.review)===reviewKey(review)) {
   return {reply:'Your booking request is pending staff review.',bookingDraft:null,intent:'BOOKING_REQUEST',bookingIntent:true,bookingAction:{serviceId:service.id,name:draft.name,contact:draft.contact,...draft.slot}};
 }
 draft.step='confirm';draft.review=review;
 return result(`Review your request: ${service.name} (${service.duration}; ${service.price||"price not provided"}); ${draft.slot.localDate} at ${draft.slot.localTime} (${knowledge.timezone}); ${draft.name}; ${draft.contact}. No calendar availability has been checked. Reply CONFIRM to submit for staff review, or CANCEL to clear this draft. To edit, use service:, date:, name: or contact: followed by the new value.`);
}
