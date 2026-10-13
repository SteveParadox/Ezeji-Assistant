function inferPrice(type, serviceName, description) {
  const text = `${type || ''} ${serviceName || ''} ${description || ''}`.toLowerCase();

  if (/restaurant|cafe|coffee|food|bar/.test(text)) return '$20–$40';
  if (/salon|beauty|barber|spa|hair|dread|loc|braid|twist/.test(text)) return '$120–$220';
  if (/clinic|doctor|medical|dent|therapy/.test(text)) return 'varies by visit';
  if (/real estate|property|agent/.test(text)) return 'contact us for a custom quote';
  return 'contact us';
}

export function buildAssistantReply(message, profile = {}, conversation = []) {
  const text = `${message || ''}`.trim();
  const context = getBusinessContext(profile);
  const { businessName, serviceName, priceText, hoursText, description } = context;
  const lower = text.toLowerCase();
  const isGreeting = /^(hi|hello|hey|good morning|good afternoon|good evening)/.test(lower);
  const isPricingQuestion = /(how much|price|cost|quote|rate|payment|paid)/.test(lower);
  const isBookingQuestion = /(book|reserve|appointment|slot|date|time|room|suite|stay|guest|reservation|friday|saturday|sunday|tomorrow|today|weekend)/.test(lower);
  const isHoursQuestion = /(hour|open|closed|when|available|today|tomorrow)/.test(lower);

  if (!text) {
    return `Hi there! I’m ${businessName}'s assistant. What can I help with today?`;
  }

  if (isGreeting) {
    return `Hi there! I’m ${businessName}'s assistant. How can I help with ${serviceName.toLowerCase()} or your booking today?`;
  }

  if (isPricingQuestion) {
    const priceLine = priceText && priceText !== 'contact us' ? `${serviceName} is ${priceText}.` : `I can help with the current pricing for ${serviceName}.`;
    return `${priceLine} If you'd like, I can also help with availability or the next step.`;
  }

  if (isHoursQuestion) {
    const hoursLine = hoursText ? `We’re typically available ${hoursText}.` : `I’m not seeing hours saved yet, but I can help check the best time.`;
    return `${businessName}'s assistant here — ${hoursLine}`;
  }

  if (isBookingQuestion) {
    const bookingLine = /two adults|for two|guests|couple|family/.test(lower)
      ? 'I can help narrow it down by date, guest count, and preferred timing.'
      : 'I can help with dates, availability, and the best option for you.';
    const detailLine = description ? ` ${description.split(/[.!?]/)[0]}.` : '';
    return `${businessName}'s assistant here — I can help with that. ${bookingLine}${detailLine}`;
  }

  const serviceLine = serviceName && serviceName !== 'your main service'
    ? `I can help with ${serviceName} and the next steps.`
    : 'I can help with bookings, availability, and service questions.';

  return `${businessName}'s assistant here — ${serviceLine} What would you like to know?`;
}

export function buildAssistantRequestPayload(message, profile = {}, conversation = [], extras = {}, options = {}) {
  const context = getBusinessContext(profile);
  const { faqs = [], services = [] } = extras;

  const faqText = faqs.length
    ? faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')
    : '';

  const servicesText = services.length
    ? services.map((s) => `- ${s.name}: ${s.price}${s.duration ? ` (${s.duration})` : ''}`).join('\n')
    : '';

  const hoursScheduleText = Array.isArray(profile?.hoursJson) && profile.hoursJson.length
    ? profile.hoursJson.map((d) => `${d.day}: ${d.closed ? 'Closed' : `${d.open} - ${d.close}`}`).join('\n')
    : '';

  const assistantName = profile?.assistantName || 'the assistant';
  const tone = profile?.tone || 'Friendly & warm';
  const greeting = profile?.greeting || '';
  const escalationKeywords = profile?.escalationKeywords || '';

  const systemPromptParts = [
    `You are ${assistantName}, a ${tone.toLowerCase()} concierge for ${context.businessName}.`,
    `Help customers with bookings, availability, questions about services, and next steps. Speak naturally, confidently, and briefly. If details are missing, ask one focused follow-up question instead of sounding robotic.`,
  ];

  if (greeting) systemPromptParts.push(`Your standard greeting style: "${greeting}"`);
  if (hoursScheduleText) systemPromptParts.push(`Business hours by day:\n${hoursScheduleText}`);
  if (servicesText) systemPromptParts.push(`Services and pricing:\n${servicesText}`);
  if (faqText) systemPromptParts.push(`Frequently asked questions you should answer directly when relevant:\n${faqText}`);
  if (escalationKeywords) systemPromptParts.push(`If the customer mentions any of these topics, let them know a team member will follow up personally instead of trying to resolve it yourself: ${escalationKeywords}.`);

  return {
    message: `${message || ''}`.trim(),
    businessId: profile?.id || null,
    preview: options.previewOnly === true,
    plan: profile?.plan || '14-day trial',
    profile: {
      business: context.businessName,
      businessType: context.displayType,
      serviceName: context.serviceName,
      price: context.priceText,
      hours: context.hoursText,
      description: context.description,
    },
    conversation: conversation.slice(-8),
    systemPrompt: systemPromptParts.join('\n\n'),
  };
}

function inferHours(type) {
  const text = `${type || ''}`.toLowerCase();

  if (/restaurant|cafe|coffee|bar/.test(text)) return 'daily from 10:00 AM to 10:00 PM';
  if (/salon|beauty|barber|spa|hair/.test(text)) return 'Mon-Sat 9:00 AM to 6:00 PM';
  if (/clinic|doctor|medical|dent|therapy/.test(text)) return 'Mon-Fri 8:00 AM to 5:00 PM';
  return 'by appointment';
}

function getLastIntent(conversation = []) {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const item = conversation[index];
    if (item?.from === 'ai') {
      const text = `${item.text || ''}`.toLowerCase();
      if (/(hour|open|closed|available)/.test(text)) return 'hours';
      if (/(price|cost|rate|quote)/.test(text)) return 'pricing';
      if (/(book|appointment|slot|reserve|room|stay|guest|dates)/.test(text)) return 'booking';
      if (/(service|special|offer)/.test(text)) return 'service';
    }
  }
  return null;
}

function getBusinessContext(profile = {}) {
  const businessType = `${profile?.businessType || profile?.businessTypeLabel || ''}`.trim().toLowerCase();
  const customType = `${profile?.customBusinessType || ''}`.trim();
  const displayType = customType || businessType || 'business';
  const businessName = profile?.business || 'your business';
  const serviceName = profile?.serviceName || 'your main service';
  const price = `${profile?.price || ''}`.trim();
  const hours = `${profile?.hours || ''}`.trim();
  const description = `${profile?.description || ''}`.trim();

  return {
    businessType,
    displayType,
    businessName,
    serviceName,
    price,
    hours,
    description,
    hasPrice: Boolean(price),
    hasHours: Boolean(hours),
    priceText: price || inferPrice(displayType, serviceName, description),
    hoursText: hours || inferHours(displayType),
  };
}

/**
 * OFFLINE FALLBACK ONLY.
 *
 * This is a hand-written template engine, not AI. It exists purely so
 * the chat widget shows *something* useful if the real /assistant-reply
 * request fails (server down, network error, etc). It should never be
 * the primary way a customer's message gets answered.
 *
 * Every reply this produces is prefixed with a visible notice in the
 * widget (see ChatWidgetDemo) so nobody — including you, while
 * testing — mistakes it for the real AI working correctly.
 */
export function buildOfflineFallbackReply(message, profile = {}, conversation = []) {
  const text = `${message || ''}`.trim().toLowerCase();
  const context = getBusinessContext(profile);
  const { businessName, serviceName, priceText, hoursText, description, hasHours, hasPrice, displayType } = context;
  const lastIntent = getLastIntent(conversation);
  const isServiceBusiness = /salon|beauty|barber|spa|hair|dread|loc|braid|twist|stylist|nail/.test(displayType) || /dread|loc|braid|twist|styling|beauty|barber|haircut/.test(description.toLowerCase());
  const openWith = `Hi there — I'm ${businessName}'s assistant.`;
  const supportLine = isServiceBusiness
    ? `I can help with appointments, availability, and service questions.`
    : `I can help with bookings, availability, and questions.`;

  if (/(hi|hello|hey|help|what can you do|start|welcome)/.test(text)) {
    return `${openWith} ${supportLine} What can I help with today?`;
  }

  if (/(book|reserve|appointment|slot|date|time|tomorrow|today|weekend|saturday|sunday|room|suite|stay|guest|reservation)/.test(text)) {
    return buildHelpfulBookingReply(context, text, lastIntent);
  }

  if (/(hour|open|closed|when|available|today|tomorrow)/.test(text)) {
    return `${openWith} ${hasHours ? `We're available ${hoursText}.` : `I don't have hours saved yet — ${hoursText} is the default.`}`;
  }

  if (/(price|cost|rate|quote|how much|how many|service)/.test(text)) {
    return `${openWith} ${hasPrice ? `${serviceName} is ${priceText}.` : `I don't have a price saved yet — ${priceText} is the default.`}`;
  }

  return `${openWith} ${supportLine}`;
}

function buildHelpfulBookingReply(context, text, lastIntent) {
  const { businessName, serviceName, priceText, hoursText, description, hasHours, hasPrice } = context;
  const roomLike = /room|suite|stay|guest|hotel|reservation|booking/.test(text);
  const serviceLike = /service|special|package|treatment|appointment/.test(text);
  const dateLike = /date|dates|friday|saturday|sunday|tomorrow|today|weekend|tonight|morning|evening/.test(text);

  if (roomLike) {
    return `${businessName}'s assistant here — I can help you check availability. ${description ? description : 'Let me know your dates and guest count.'}`;
  }

  if (serviceLike) {
    return `${businessName}'s assistant here — ${hasPrice ? `${serviceName} starts at ${priceText}.` : `A starting point is ${priceText}.`}${hasHours ? ` We're usually open ${hoursText}.` : ''}`;
  }

  if (lastIntent === 'booking') {
    return `${businessName}'s assistant here — let's narrow down the date, timing, or preferred option.`;
  }

  if (dateLike) {
    return `${businessName}'s assistant here — tell me the day, guest count, or preferred time and I'll take it from there.`;
  }

  return `${businessName}'s assistant here — I can help with dates, availability, or the best option for you.${hasHours ? ` We're usually open ${hoursText}.` : ''}`;
}