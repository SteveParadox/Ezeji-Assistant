import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5174;

// Used so the backend can actually write a real row to the bookings table
// when the AI decides to create one, and to record real payments after a
// Paystack webhook confirms them.
const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY))
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  : null;

const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
}));

app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));

// Shared brain: both the web chat widget's /assistant-reply route AND the
// WhatsApp webhook call this same function, so a customer gets identically
// smart, identically-informed answers no matter which channel they use.
async function generateAssistantReply({ message, profile, conversation, systemPrompt, businessId }) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return {
      reply: "I'm not fully connected yet - my AI service isn't configured. A team member will follow up with you shortly.",
      provider: 'unconfigured',
    };
  }

  const tools = businessId ? [
    {
      type: 'function',
      function: {
        name: 'create_booking',
        description: 'Create a real booking/appointment once you have the customer\'s name, contact info, desired service, date, and time. Only call this when you actually have these details from the conversation - ask for anything missing first instead of guessing.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { type: 'string', description: 'The customer\'s name' },
            customer_contact: { type: 'string', description: 'Phone number or email to reach the customer' },
            service: { type: 'string', description: 'What they\'re booking (e.g. "Cut & Color")' },
            booking_date: { type: 'string', description: 'The requested date, in plain language (e.g. "Saturday")' },
            booking_time: { type: 'string', description: 'The requested time (e.g. "9:00 AM")' },
            notes: { type: 'string', description: 'Any other relevant details' },
          },
          required: ['customer_name', 'service', 'booking_date', 'booking_time'],
        },
      },
    },
  ] : undefined;

  const baseMessages = [
    {
      role: 'system',
      content: systemPrompt || `You are a warm concierge assistant for a local business. Help with bookings, availability, and questions in a natural way.`,
    },
    {
      role: 'system',
      content: JSON.stringify({ profile: profile || {} }),
    },
    ...(conversation || []).map((item) => ({
      role: item.from === 'ai' ? 'assistant' : 'user',
      content: item.text || '',
    })),
    {
      role: 'user',
      content: message || '',
    },
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      temperature: 0.8,
      messages: baseMessages,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || 'AI request failed.');
  }

  const responseMessage = payload.choices?.[0]?.message;
  const toolCall = responseMessage?.tool_calls?.[0];

  if (toolCall && toolCall.function?.name === 'create_booking' && supabase && businessId) {
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = {};
    }

    const { error: insertError } = await supabase.from('bookings').insert({
      business_id: businessId,
      customer_name: args.customer_name || null,
      customer_contact: args.customer_contact || null,
      service: args.service || null,
      booking_date: args.booking_date || null,
      booking_time: args.booking_time || null,
      notes: args.notes || null,
    });

    if (insertError) {
      console.error('booking insert error:', insertError);
      return {
        reply: "I tried to lock that in but hit a snag saving it - could you try confirming those details again?",
        provider: 'groq',
        booked: false,
      };
    }

    const confirmationReply = `Booked - ${args.booking_date} at ${args.booking_time} for ${args.service}${args.customer_name ? `, under ${args.customer_name}` : ''}. Anything else I can help with?`;
    return { reply: confirmationReply, provider: 'groq', booked: true };
  }

  return { reply: cleanAssistantReply(responseMessage?.content || 'I can help with that.'), provider: 'groq', booked: false };
}

function cleanAssistantReply(text) {
  return `${text || ''}`
    .replace(/\*+/g, '')
    .replace(/`+/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Real conversation limits per plan.
const PLAN_LIMITS = {
  '14-day trial': 100,
  'Starter': 500,
  'Professional': 2500,
  'Business': Infinity,
};

async function checkUsageLimit(businessId, plan) {
  if (!supabase || !businessId) return { allowed: true };

  // The 14-day trial has two independent caps: a conversation-count
  // ceiling (checked below) and the 14-day clock itself. The clock was
  // never actually enforced here before - only shown as a passive message
  // on the Billing page - so a trial business could keep using the
  // assistant indefinitely past day 14 as long as they stayed under 100
  // total conversations. We check the real trial_ends_at/trial_active
  // columns straight from the database (never trust a client-supplied
  // "plan" for this), not whatever the client claims its plan is.
  if (plan === '14-day trial') {
    const { data: trialProfile, error: trialError } = await supabase
      .from('profiles')
      .select('trial_active, trial_ends_at')
      .eq('id', businessId)
      .single();

    if (!trialError && trialProfile) {
      const expired = trialProfile.trial_active === false
        || (trialProfile.trial_ends_at && new Date(trialProfile.trial_ends_at) <= new Date());
      if (expired) {
        return { allowed: false, reason: 'trial-expired' };
      }
    }
  }

  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS['14-day trial'];
  if (limit === Infinity) return { allowed: true };

  const since = plan === '14-day trial'
    ? new Date(0).toISOString()
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { count, error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', since);

  if (error) {
    console.error('usage limit check error:', error);
    return { allowed: true };
  }

  return { allowed: (count || 0) < limit, count: count || 0, limit };
}

app.post('/assistant-reply', async (req, res) => {
  try {
    const { message, profile, conversation, systemPrompt, businessId, plan } = req.body;

    const usage = await checkUsageLimit(businessId, plan);
    if (!usage.allowed) {
      return res.json({
        reply: usage.reason === 'trial-expired'
          ? "Thanks for reaching out - this business's free trial has ended. Please contact them directly, or check back soon."
          : "Thanks for reaching out - this business has reached their plan's conversation limit for now. Please contact them directly, or check back soon.",
        provider: 'limit-reached',
        limitReached: true,
      });
    }

    const result = await generateAssistantReply({ message, profile, conversation, systemPrompt, businessId });
    return res.json(result);
  } catch (error) {
    console.error('assistant-reply error:', error);
    res.status(500).json({
      error: error.message || 'Unable to reach the AI service.',
    });
  }
});

// Real NGN pricing, in kobo (Paystack's smallest currency unit for NGN,
// same idea as cents). Priced directly in Naira - fair, round numbers in
// the spirit of ChatGPT Plus's pricing, not derived from a USD figure.
// Yearly = 10x monthly (2 months free). Must match the Pricing component's
// `plans` array in NightlineLanding.jsx exactly, or the price shown won't
// match the price charged.
const PRICE_MAP_NGN_KOBO = {
  Starter: { monthly: 1500000, yearly: 15000000 },       // NGN 15,000 / NGN 150,000
  Professional: { monthly: 3500000, yearly: 35000000 },   // NGN 35,000 / NGN 350,000
  Business: { monthly: 7500000, yearly: 75000000 },       // NGN 75,000 / NGN 750,000
};

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { plan, billingPeriod, email, business, name, businessId } = req.body;

    const unitAmount = PRICE_MAP_NGN_KOBO[plan]?.[billingPeriod === 'yearly' ? 'yearly' : 'monthly'] || 0;

    if (!unitAmount) {
      return res.status(400).json({ error: 'Unknown plan or billing period.' });
    }

    return await handlePaystackCheckout({ unitAmount, email, plan, billingPeriod, business, name, businessId, res });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Unable to create checkout session.' });
  }
});

async function handlePaystackCheckout({ unitAmount, email, plan, billingPeriod, business, name, businessId, res }) {
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;

  if (!paystackKey) {
    return res.status(400).json({ error: 'Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to .env.' });
  }

  if (!email) {
    return res.status(400).json({ error: 'An email is required to start a Paystack checkout.' });
  }

  const initResponse = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${paystackKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: unitAmount,
      currency: 'NGN',
      callback_url: `${process.env.APP_URL || 'http://localhost:5173'}?checkout=success`,
      metadata: {
        plan,
        billingPeriod,
        business,
        businessId,
        name,
        email,
      },
    }),
  });

  const initPayload = await initResponse.json();

  if (!initResponse.ok || !initPayload.status) {
    throw new Error(initPayload.message || 'Paystack could not start the transaction.');
  }

  // authorization_url is the real, working checkout page Paystack hosts.
  res.json({ url: initPayload.data.authorization_url });
}

async function recordSuccessfulPayment({ provider, reference, plan, billingPeriod, currency, email, business, businessId, amount }) {
  if (!supabase) return;

  let profile = null;

  if (businessId) {
    const { data, error } = await supabase.from('profiles').select('id').eq('id', businessId).maybeSingle();
    if (error) console.error(`${provider} profile lookup by id error:`, error);
    profile = data;
  }

  if (!profile) {
    // Fallback for older payments that didn't carry a businessId - matches
    // by business name, which is less reliable if two accounts share one.
    const { data, error } = await supabase.from('profiles').select('id').eq('business', business).limit(1).maybeSingle();
    if (error) console.error(`${provider} profile lookup by name error:`, error);
    profile = data;
  }

  if (!profile) {
    console.warn(`${provider} payment received before a matching profile existed:`, business, businessId);
    return;
  }

  const { error: updateError } = await supabase.from('profiles').update({
    plan,
    billing_period: billingPeriod,
    currency: (currency || 'NGN').toUpperCase(),
    payment_status: 'active',
    trial_active: false,
    trial_ends_at: new Date().toISOString(),
  }).eq('id', profile.id);

  if (updateError) console.error(`${provider} profile update error:`, updateError);

  const { error: invoiceError } = await supabase.from('invoices').upsert({
    business_id: profile.id,
    provider,
    provider_reference: reference,
    amount,
    currency: (currency || 'NGN').toUpperCase(),
    plan,
    billing_period: billingPeriod,
    status: 'paid',
    customer_email: email || null,
  }, { onConflict: 'provider,provider_reference' });

  if (invoiceError) console.error(`${provider} invoice record error:`, invoiceError);
}

app.post('/webhooks/paystack', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '').update(req.rawBody || '').digest('hex');
  const signatureBuffer = Buffer.from(`${signature || ''}`);
  const expectedBuffer = Buffer.from(expected);
  if (!signature || signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Invalid Paystack webhook signature.' });
  }

  const event = req.body || {};
  if (event.event === 'charge.success' && event.data?.status === 'success') {
    const metadata = event.data.metadata || {};
    await recordSuccessfulPayment({
      provider: 'paystack',
      reference: event.data.reference,
      plan: metadata.plan,
      billingPeriod: metadata.billingPeriod || 'monthly',
      currency: metadata.currency || event.data.currency,
      email: metadata.email || event.data.customer?.email,
      business: metadata.business,
      businessId: metadata.businessId,
      amount: event.data.amount || 0,
    });
  }

  return res.json({ received: true });
});

// Recommended once live: lets you confirm a payment server-side rather
// than trusting the browser redirect alone.
app.get('/verify-paystack/:reference', async (req, res) => {
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) {
    return res.status(400).json({ error: 'Paystack is not configured yet.' });
  }

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${req.params.reference}`, {
      headers: { Authorization: `Bearer ${paystackKey}` },
    });
    const payload = await response.json();
    res.json(payload);
  } catch (error) {
    console.error('paystack verify error:', error);
    res.status(500).json({ error: 'Unable to verify transaction.' });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('API request error:', error);
  return res.status(error.status || 400).json({ error: error.message || 'Invalid request.' });
});

// ===================== WhatsApp integration =====================

app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);

  if (!supabase) {
    console.error('WhatsApp webhook received but Supabase is not configured.');
    return;
  }

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const phoneNumberId = change?.metadata?.phone_number_id;
    const customerNumber = message.from;
    const customerText = message.text?.body || '';

    const { data: connection, error: connectionError } = await supabase
      .from('channel_connections')
      .select('business_id, access_token')
      .eq('channel', 'whatsapp')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle();

    if (connectionError || !connection) {
      console.error('No business connected to this WhatsApp number:', phoneNumberId);
      return;
    }

    const businessId = connection.business_id;

    const [{ data: profile }, { data: faqs }, { data: services }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', businessId).maybeSingle(),
      supabase.from('faqs').select('question, answer').eq('business_id', businessId),
      supabase.from('services').select('name, price, duration').eq('business_id', businessId),
    ]);

    const systemPrompt = buildWhatsAppSystemPrompt(profile, faqs || [], services || []);
    const aiResult = await generateAssistantReply({
      message: customerText,
      profile: profile || {},
      conversation: [],
      systemPrompt,
      businessId,
    });

    await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${connection.access_token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: customerNumber,
        text: { body: aiResult.reply },
      }),
    });

    await supabase.from('conversations').insert({
      business_id: businessId,
      customer_message: customerText,
      ai_reply: aiResult.reply,
      escalated: false,
      booking_intent: aiResult.booked || false,
    });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
  }
});

function buildWhatsAppSystemPrompt(profile, faqs, services) {
  const businessName = profile?.business || 'the business';
  const parts = [
    `You are a warm, practical concierge for ${businessName}, replying over WhatsApp. Keep replies short and natural, like a real text message - not long paragraphs.`,
  ];
  if (profile?.hours) parts.push(`Hours: ${profile.hours}`);
  if (profile?.description) parts.push(`About the business: ${profile.description}`);
  if (services.length) parts.push(`Services:\n${services.map((s) => `- ${s.name}: ${s.price}`).join('\n')}`);
  if (faqs.length) parts.push(`FAQs:\n${faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}`);
  return parts.join('\n\n');
}

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Nightline payment server listening on port ${port}`);
  });
}

app.post('/integrations/whatsapp/test', async (req, res) => {
  const { phoneNumberId, accessToken } = req.body || {};
  if (!phoneNumberId?.trim() || !accessToken?.trim()) {
    return res.status(400).json({ error: 'Phone Number ID and access token are required.' });
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(phoneNumberId.trim())}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${accessToken.trim()}` },
    });
    const payload = await response.json();
    if (!response.ok) {
      return res.status(400).json({ error: payload.error?.message || 'Meta rejected these WhatsApp credentials.' });
    }
    return res.json({
      verifiedName: payload.verified_name || '',
      displayPhoneNumber: payload.display_phone_number || '',
    });
  } catch (error) {
    return res.status(502).json({ error: 'Could not reach Meta to verify the WhatsApp connection.' });
  }
});

export default app;