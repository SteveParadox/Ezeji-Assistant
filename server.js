import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { attachStaffRoutes } from './server/staffRoutes.js';
import { ensureOwnerBusiness } from './server/businessProvisioning.js';
import { validatePaymentReplay } from './server/paymentReplay.js';
import { attachWhatsAppRoutes, decryptToken } from './server/whatsappConnections.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5174;

// Used so the backend can actually write a real row to the bookings table
// when the AI decides to create one, and to record real payments after a
// Paystack webhook confirms them.
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: {persistSession:false} })
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
  limit: '48kb',
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

  // No AI-generated confirmed booking until independent, atomic availability validation exists.
  const tools = undefined;

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
    signal: AbortSignal.timeout(15000),
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

async function checkUsageLimit(businessId) {
  if (!supabase) throw new Error('Usage database unavailable');
  const result=await supabase.from('profiles').select('plan,payment_status,trial_active,trial_ends_at').eq('id',businessId).maybeSingle();
  if (result.error || !result.data) throw new Error('Business entitlement unavailable');
  const plan=result.data.plan;
  if (plan==='14-day trial' && (result.data.trial_active!==true || !result.data.trial_ends_at || Date.parse(result.data.trial_ends_at)<=Date.now())) return {allowed:false,reason:'trial-expired'};
  if (plan!=='14-day trial' && result.data.payment_status!=='active') return {allowed:false,reason:'subscription-inactive'};
  const limit=PLAN_LIMITS[plan];
  if (limit===undefined) return {allowed:false,reason:'unknown-plan'};
  if (limit===Infinity) return {allowed:true,limit};
  const now=new Date();
  const since=plan==='14-day trial' ? new Date(0).toISOString() : new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const {count,error}=await supabase.from('conversations').select('id',{count:'exact',head:true}).eq('business_id',businessId).gte('created_at',since);
  if (error) throw new Error('Usage count unavailable');
  return {allowed:(count||0)<limit,count:count||0,limit};
}

app.post('/assistant-reply', async (req,res)=>{
  try {
    const {message,businessId,conversation}=req.body||{};
    if(typeof businessId!=='string'|| !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(businessId)) return res.status(400).json({error:'Invalid business'});
    if(typeof message!=='string'||!message.trim()||message.length>2000) return res.status(400).json({error:'Invalid message'});
    if(conversation!==undefined && (!Array.isArray(conversation)||conversation.length>12||conversation.some(x=>!x||!['customer','ai'].includes(x.from)||typeof x.text!=='string'||x.text.length>2000))) return res.status(400).json({error:'Invalid history'});
    if(!supabase) return res.status(503).json({error:'Service unavailable'});
    const [prof,faq,services]=await Promise.all([
      supabase.from('profiles').select('id,business,service_name,price,hours,description').eq('id',businessId).maybeSingle(),
      supabase.from('faqs').select('question,answer').eq('business_id',businessId).limit(60),
      supabase.from('services').select('name,price,duration').eq('business_id',businessId).limit(60)
    ]);
    if(prof.error||faq.error||services.error) return res.status(503).json({error:'Business lookup unavailable'});
    if(!prof.data) return res.status(404).json({error:'Business not found'});
    const usage=await checkUsageLimit(businessId);
    if(!usage.allowed) return res.status(429).json({reply:'This business is temporarily unable to accept AI conversations. Contact them directly.',provider:'limit-reached',limitReached:true});
    const p=prof.data;
    const systemPrompt=`You are a customer assistant for ${p.business}. Answer using only business facts provided below. Do not invent availability or claim any booking is confirmed. Booking requests must be confirmed by staff. Hours: ${p.hours||'Not provided'}. Description: ${p.description||''}. Services: ${JSON.stringify(services.data||[])}. FAQs: ${JSON.stringify(faq.data||[])}`;
    const result=await generateAssistantReply({message:message.trim(),profile:{business:p.business,serviceName:p.service_name,price:p.price,hours:p.hours},conversation:conversation||[],systemPrompt});
    if(result.provider==='groq') {
      const {error:writeError}=await supabase.from('conversations').insert({business_id:businessId,customer_message:message.trim(),ai_reply:result.reply,escalated:false,booking_intent:/book|reserve|appointment/i.test(message)});
      if(writeError) throw new Error('Conversation persistence unavailable');
    }
    return res.json(result);
  } catch(error) {
    console.error('assistant-reply error:',error.message);
    return res.status(503).json({error:'Assistant temporarily unavailable'});
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

// The service-role database client is server-only. The bearer token is
// verified on every request, and the owner ID is always derived from it.
app.post('/business/profile/ensure', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database unavailable' });
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!bearer) return res.status(401).json({ error: 'Sign in required' });
    const { data: auth, error: authError } = await supabase.auth.getUser(bearer[1]);
    if (authError || !auth?.user) return res.status(401).json({ error: 'Invalid session' });
    if (!auth.user.email_confirmed_at) return res.status(403).json({ error: 'Verify your email before onboarding.' });
    const result = await ensureOwnerBusiness(
      supabase, auth.user.id, req.body?.fields, auth.user.user_metadata?.business_registration
    );
    return res.json(result);
  } catch (error) {
    if (error.status === 422) return res.status(422).json({ error: error.message });
    console.error('Business onboarding error:', error.message);
    return res.status(503).json({ error: 'Business setup is temporarily unavailable. Please retry.' });
  }
});

app.post('/create-checkout-session', async (req,res)=>{
  try {
    if (!supabase) return res.status(503).json({error:'Database unavailable'});
    const bearer=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');
    if(!bearer) return res.status(401).json({error:'Sign in required'});
    const {data:auth,error:authError}=await supabase.auth.getUser(bearer[1]);
    if(authError||!auth?.user) return res.status(401).json({error:'Invalid session'});
    const {data:business,error:businessError}=await supabase.from('profiles').select('id,business,plan,payment_status,billing_period').eq('id',auth.user.id).maybeSingle();
    if(businessError||!business) return res.status(403).json({error:'Business account not found'});
    const {plan,billingPeriod}=req.body||{};
    if(!Object.hasOwn(PRICE_MAP_NGN_KOBO,plan)||!['monthly','yearly'].includes(billingPeriod)) return res.status(400).json({error:'Invalid plan or billing period'});
    if(business.payment_status==='active' && business.plan===plan && business.billing_period===billingPeriod) return res.status(409).json({error:'This subscription is already active.'});
    return await handlePaystackCheckout({
      unitAmount:PRICE_MAP_NGN_KOBO[plan][billingPeriod],
      email:auth.user.email,plan,billingPeriod,
      business:business.business,name:auth.user.user_metadata?.name||'',businessId:business.id,res
    });
  }catch(error){console.error('checkout error:',error.message);return res.status(503).json({error:'Unable to begin checkout'});}
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
    signal: AbortSignal.timeout(15000),
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
  if(!supabase) throw new Error('Payment database unavailable');
  if(!businessId || !Object.hasOwn(PRICE_MAP_NGN_KOBO,plan) || !['monthly','yearly'].includes(billingPeriod) || (currency||'').toUpperCase()!=='NGN' || amount!==PRICE_MAP_NGN_KOBO[plan][billingPeriod]) throw new Error('Invalid payment metadata or amount');
  const { data: prior, error: priorError } = await supabase.from('invoices')
    .select('business_id,provider,plan,billing_period,amount,currency,status')
    .eq('provider', provider).eq('provider_reference', reference).maybeSingle();
  if (priorError) throw priorError;
  const action = validatePaymentReplay(prior, {
    reference, provider, plan, businessId, billingPeriod, currency, amount,
  });
  if (action === 'already_settled') return;
  let profile = null;

  if (businessId) {
    const { data, error } = await supabase.from('profiles').select('id').eq('id', businessId).maybeSingle();
    if (error) console.error(`${provider} profile lookup by id error:`, error);
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

  if (updateError) throw updateError;

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

  if (invoiceError) throw invoiceError;
}

app.post('/webhooks/paystack', async (req, res) => {
  if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Payment webhook not configured.' });
  const signature = req.headers['x-paystack-signature'];
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '').update(req.rawBody || '').digest('hex');
  const signatureBuffer = Buffer.from(`${signature || ''}`);
  const expectedBuffer = Buffer.from(expected);
  if (!signature || signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Invalid Paystack webhook signature.' });
  }

  try {
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
  }catch(error){console.error('Payment settlement failed:',error.message);return res.status(503).json({error:'Payment could not be recorded'});}
});

// Recommended once live: lets you confirm a payment server-side rather
// than trusting the browser redirect alone.
// Verification is private to the authenticated business owner. Do not return
// raw Paystack customer or authorization details to arbitrary reference lookups.
app.get('/verify-paystack/:reference', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database unavailable' });
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!bearer) return res.status(401).json({ error: 'Sign in required' });
    const { data: auth, error: authError } = await supabase.auth.getUser(bearer[1]);
    if (authError || !auth?.user) return res.status(401).json({ error: 'Invalid session' });
    const reference = req.params.reference;
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(reference)) {
      return res.status(400).json({ error: 'Invalid reference' });
    }
    const { data: invoice, error: invoiceError } = await supabase.from('invoices')
      .select('business_id,status').eq('provider', 'paystack')
      .eq('provider_reference', reference).eq('business_id', auth.user.id).maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return res.status(404).json({ error: 'Payment reference not found' });
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Payment verification is unavailable' });
    const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Paystack verification unavailable');
    const payload = await response.json();
    return res.json({ verified: invoice.status === 'paid' && payload.data?.status === 'success' });
  } catch (error) {
    console.error('Paystack verification error:', error.message);
    return res.status(503).json({ error: 'Unable to verify transaction' });
  }
});

app.get('/health', (req,res) => res.json({status:'alive'}));

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

  if (mode === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  const provided=req.headers['x-hub-signature-256'];
  const secret=process.env.WHATSAPP_APP_SECRET;
  if(!secret||typeof provided!=='string'||!Buffer.isBuffer(req.rawBody)) return res.sendStatus(401);
  const expected=Buffer.from('sha256='+crypto.createHmac('sha256',secret).update(req.rawBody).digest('hex'));
  const actual=Buffer.from(provided);
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)) return res.sendStatus(401);
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
    const usage = await checkUsageLimit(businessId);
    if (!usage.allowed) { console.warn('WhatsApp subscription or quota denied', businessId); return; }

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
        Authorization: `Bearer ${decryptToken(connection.access_token)}`,
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

attachStaffRoutes(app,supabase);

attachWhatsAppRoutes(app,supabase);

export default app;
