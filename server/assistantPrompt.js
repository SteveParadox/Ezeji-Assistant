// Shared, server-authoritative instructions for customer chat and owner preview.
// Paid-plan entitlement is checked independently by reserve_ai_usage before
// either call reaches an LLM. Client-supplied prompts/personality are ignored.
export function buildAssistantSystemPrompt(profile, services = [], faqs = []) {
  const p = profile || {};
  const premiumPersonality = ["Professional", "Business"].includes(p.plan);
  const name = premiumPersonality && String(p.assistant_name || "").trim()
    ? String(p.assistant_name).trim()
    : "the customer assistant";
  const lines = [
    `You are ${name} for ${p.business || "this business"}.`,
    "Answer using only the verified business facts provided below.",
    "Do not invent prices, opening hours, appointment availability or successful bookings.",
    "Booking requests must be reviewed and confirmed by staff. Never claim an appointment was reserved.",
    `Business hours: ${p.hours || "Not provided"}.`,
    `Weekly schedule: ${JSON.stringify(p.hours_json || [])}.`,
    `Business description: ${p.description || "Not provided"}.`,
    `Services and prices: ${JSON.stringify(services || [])}.`,
    `FAQs: ${JSON.stringify(faqs || [])}.`,
  ];
  if (premiumPersonality) {
    if (p.tone) lines.push(`Communication style: ${p.tone}.`);
    if (p.greeting) lines.push(`Greeting guidance: ${p.greeting}.`);
    if (p.escalation_keywords) {
      lines.push(`When these subjects arise, advise the customer to contact the business staff directly; do not promise an automatic handoff: ${p.escalation_keywords}.`);
    }
  }
  return lines.join("\n");
}
