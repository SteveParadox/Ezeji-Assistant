import {selectedService} from './assistantBooking.js';
export function factualReply({message,intent,knowledge,thread}) {
 const pricing=intent==='PRICING'||/\b(how much|price|pricing|cost|rate)\b/i.test(message);
 const hours=intent==='HOURS'||/\b(opening hours|business hours|what.*hours|when.*open)\b/i.test(message);
 if(!pricing&&!hours)return null;
 const lines=[];
 if(pricing) {
  const selected=selectedService(message,knowledge,thread)||(knowledge.services.length===1?knowledge.services[0]:null);
  const rows=selected?[selected]:knowledge.services;
  if(rows.length)lines.push(rows.slice(0,8).map(s=>`${s.name}: ${s.price||'price not provided; please ask staff'}.`).join('\n'));
  else if(knowledge.primaryService.name&&knowledge.primaryService.price)lines.push(`${knowledge.primaryService.name}: ${knowledge.primaryService.price}.`);
  else lines.push('No verified service pricing is saved. Please ask staff for a quote.');
 }
 if(hours) {
  const schedule=knowledge.weeklyHours.filter(d=>d&&typeof d.day==='string');
  if(schedule.length)lines.push(`Saved hours (${knowledge.timezone}):\n${schedule.map(d=>`${d.day}: ${d.closed?'closed':d.open&&d.close?`${d.open}–${d.close}`:'hours not configured'}`).join('\n')}. Days without a saved entry require staff confirmation.`);
  else lines.push(knowledge.hours?`Saved hours: ${knowledge.hours}.`:'No verified business hours are saved. Please confirm with staff.');
 }
 return {reply:lines.join('\n\n'),intent:pricing?'PRICING':'HOURS',grounded:true};
}
