export const PROFILE_KNOWLEDGE_FIELDS = 'id,business,business_type,custom_business_type,plan,service_name,price,currency,hours,hours_json,timezone,description,address,city_state_zip,contact_phone,public_contact_email,website,assistant_name,tone,greeting,escalation_keywords,assistant_active,booking_policy,cancellation_policy,refund_policy,language_preferences';
const text = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
export function normalizeKnowledge(profile = {}, services = [], faqs = []) {
  const premium = ['Professional', 'Business'].includes(profile.plan);
  return {
    business: text(profile.business, 160), category: text(profile.custom_business_type || profile.business_type, 160),
    description: text(profile.description), currency: text(profile.currency, 8) || 'NGN',
    timezone: text(profile.timezone, 80), hours: text(profile.hours, 1000), weeklyHours: Array.isArray(profile.hours_json) ? profile.hours_json.slice(0, 7) : [],
    location: [text(profile.address, 300), text(profile.city_state_zip, 160)].filter(Boolean).join(', '),
    contact: { phone: text(profile.contact_phone, 40), email: text(profile.public_contact_email, 160), website: text(profile.website, 300) },
    policies: { booking: text(profile.booking_policy, 1500), cancellation: text(profile.cancellation_policy, 1500), refund: text(profile.refund_policy, 1500) },
    style: premium ? { name: text(profile.assistant_name, 80), tone: ['Friendly & warm', 'Professional', 'Playful', 'Concise'].includes(profile.tone) ? profile.tone : 'Friendly & warm', greeting: text(profile.greeting, 500), escalationTopics: text(profile.escalation_keywords, 500), languages: text(profile.language_preferences, 160) } : { name: 'the customer assistant', tone: 'Friendly & warm' },
    services: services.slice(0, 60).map(s => ({ id: s.id, name: text(s.name, 160), price: text(s.price, 160), duration: text(s.duration, 80), description: text(s.description, 600) })),
    faqs: faqs.slice(0, 60).map(f => ({ question: text(f.question, 300), answer: text(f.answer, 1000) })),
    primaryService: { name: text(profile.service_name, 160), price: text(profile.price, 160) },
  };
}
export async function loadBusinessKnowledge(db, businessId) {
  // No process-local cache: owner edits and deletions affect the next request.
  const [p, s, f] = await Promise.all([
    db.from('profiles').select(PROFILE_KNOWLEDGE_FIELDS).eq('id', businessId).maybeSingle(),
    db.from('services').select('id,name,price,duration,description').eq('business_id', businessId).order('created_at').limit(60),
    db.from('faqs').select('question,answer').eq('business_id', businessId).order('created_at').limit(60),
  ]);
  if (p.error || s.error || f.error) throw Object.assign(new Error('Business information unavailable'), { status: 503 });
  if (!p.data) throw Object.assign(new Error('Business not found'), { status: 404 });
  return { profile: p.data, knowledge: normalizeKnowledge(p.data, s.data || [], f.data || []) };
}
export function boundedKnowledge(knowledge, maxBytes = 20000) {
  const copy = structuredClone(knowledge); let omitted = false;
  while (Buffer.byteLength(JSON.stringify(copy)) > maxBytes && (copy.faqs.length || copy.services.length)) {
    if (copy.faqs.length) copy.faqs.pop(); else copy.services.pop(); omitted = true;
  }
  return { ...copy, incomplete: omitted };
}
export function assistantReadiness(p, services = []) {
  const missing = [];
  if (!p.business?.trim()) missing.push('Business name');
  if (!p.description?.trim()) missing.push('Business description');
  if (!services.length && !p.service_name?.trim()) missing.push('Services');
  if (!p.contact_phone && !p.public_contact_email) missing.push('Public contact details');
  return { ready: missing.length === 0, missing, bookingReady: !!p.hours_json?.some(d => !d.closed && d.open && d.close) && services.some(s => s.duration) };
}
