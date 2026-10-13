import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { attachStaffRoutes } from './server/staffRoutes.js';
import { ensureOwnerBusiness } from './server/businessProvisioning.js';
import { isSameActiveSubscription } from './server/paymentReplay.js';
import { newPaystackReference, PAYSTACK_REFERENCE_PATTERN, parseVerifiedPaystackTransaction, paymentMatchesAttempt, isTrustedPaystackCheckoutUrl } from './server/paystackSettlement.js';
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
  if (plan!=='14-day trial') {
    const { data: allowed, error: entitlementError } = await supabase.rpc('has_current_paid_entitlement', {p_business_id:businessId});
    if(entitlementError) throw entitlementError;
    if(allowed !== true) return {allowed:false,reason:'subscription-expired'};
  }
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
    if (!auth.user.email_confirmed_at) return res.status(403).json({error:'Verify your email before checkout'});
    const {data:business,error:businessError}=await supabase.from('profiles').select('id,business,plan,payment_status,billing_period').eq('id',auth.user.id).maybeSingle();
    if(businessError||!business) return res.status(403).json({error:'Business account not found'});
    const {plan,billingPeriod}=req.body||{};
    if(!Object.hasOwn(PRICE_MAP_NGN_KOBO,plan)||!['monthly','yearly'].includes(billingPeriod)) return res.status(400).json({error:'Invalid plan or billing period'});
    const { data: activeSubscription, error: activeError } = await supabase.from('subscriptions')
      .select('plan,billing_period,status,current_period_end').eq('business_id', business.id).maybeSingle();
    if (activeError) throw activeError;
    if (activeSubscription && ['active','cancellation_scheduled'].includes(activeSubscription.status)
      && Date.parse(activeSubscription.current_period_end) > Date.now()
      && activeSubscription.plan === plan && activeSubscription.billing_period === billingPeriod) {
      return res.status(409).json({error:'This subscription is already active.'});
    }
    return await handlePaystackCheckout({
      unitAmount:PRICE_MAP_NGN_KOBO[plan][billingPeriod],
      email:auth.user.email,plan,billingPeriod,
      business:business.business,name:auth.user.user_metadata?.name||'',businessId:business.id,res
    });
  }catch(error){console.error('checkout error:',error.message);return res.status(503).json({error:'Unable to begin checkout'});}
});


function settlementError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Do not issue a paid checkout until the required database settlement
// migration has been deployed. Pending checkouts are durable before Paystack
// receives the reference, including if Paystack responds too late.
async function checkSettlementReady() {
  const { data, error } = await supabase.rpc('production_billing_ready');
  if (error || data !== true) throw settlementError('Payment settlement migration is not available');
}

async function handlePaystackCheckout({ unitAmount, email, plan, billingPeriod, business, name, businessId, res }) {
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) return res.status(503).json({ error: 'Paystack is not configured.' });
  if (!email) return res.status(400).json({ error: 'A verified account email is required for checkout.' });

  await checkSettlementReady();
  const reference = newPaystackReference();
  const { error: attemptError } = await supabase.from('checkout_attempts').insert({
    business_id: businessId,
    user_id: businessId,
    provider: 'paystack',
    provider_reference: reference,
    plan,
    billing_period: billingPeriod,
    expected_amount: unitAmount,
    currency: 'NGN',
    customer_email: email.trim().toLowerCase(),
    status: 'pending',
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });
  if (attemptError) throw attemptError;

  let initResponse;
  let initPayload;
  try {
    initResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${paystackKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference,
        email,
        amount: unitAmount,
        currency: 'NGN',
        callback_url: `${process.env.APP_URL || 'http://localhost:5173'}?checkout=success`,
        metadata: { plan, billingPeriod, business, businessId, name },
      }),
    });
    initPayload = await initResponse.json();
  } catch (error) {
    // A timeout is ambiguous: Paystack might have accepted the checkout.
    // Keep it pending so any later successful webhook can settle safely.
    throw settlementError('Paystack initialization could not be confirmed');
  }

  if (!initResponse.ok || initPayload?.status !== true) {
    await supabase.from('checkout_attempts').update({
      status: 'initialization_failed', updated_at: new Date().toISOString(),
    }).eq('provider', 'paystack').eq('provider_reference', reference).eq('status', 'pending');
    throw settlementError('Paystack rejected checkout initialization');
  }

  if (initPayload.data?.reference !== reference ||
      !isTrustedPaystackCheckoutUrl(initPayload.data?.authorization_url)) {
    throw settlementError('Paystack returned an invalid checkout reference or URL');
  }
  const { error: markError } = await supabase.from('checkout_attempts').update({
    status: 'initialized', provider_initialized_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('provider', 'paystack').eq('provider_reference', reference).eq('status', 'pending');
  if (markError) throw markError;
  return res.json({ url: initPayload.data.authorization_url, reference });
}

async function loadPaymentAttempt(reference) {
  if (!PAYSTACK_REFERENCE_PATTERN.test(reference || '')) throw settlementError('Invalid payment reference', 400);
  const { data, error } = await supabase.from('checkout_attempts')
    .select('business_id,provider,provider_reference,provider_transaction_id,plan,billing_period,expected_amount,currency,customer_email,status,expires_at,applied_to_subscription')
    .eq('provider', 'paystack').eq('provider_reference', reference).maybeSingle();
  if (error) throw error;
  if (!data) throw settlementError('Payment attempt not found; requires reconciliation');
  return data;
}

async function fetchVerifiedPaystackPayment(reference) {
  if (!process.env.PAYSTACK_SECRET_KEY) throw settlementError('Paystack is not configured');
  const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw settlementError('Paystack verification unavailable');
  const payload = await response.json();
  return parseVerifiedPaystackTransaction(payload, reference);
}

async function recordSuccessfulPayment(reference, webhookCharge) {
  if (!supabase) throw settlementError('Payment database unavailable');
  const attempt = await loadPaymentAttempt(reference);
  const verified = await fetchVerifiedPaystackPayment(reference);
  if (!paymentMatchesAttempt(verified, attempt)) {
    throw settlementError('Verified provider payment conflicts with checkout intent', 422);
  }
  // The signed notification must be about the very same verified charge.
  if (webhookCharge && (webhookCharge.amount !== verified.p_amount ||
      String(webhookCharge.currency || '').toUpperCase() !== verified.p_currency)) {
    throw settlementError('Webhook and Paystack verification disagree', 422);
  }
  const { data, error } = await supabase.rpc('settle_paystack_payment', verified);
  if (error) throw error;
  const outcome = Array.isArray(data) ? data[0] : data;
  if (!outcome || !['settled', 'already_settled', 'review_required'].includes(outcome.outcome) ||
      outcome.settled_business_id !== attempt.business_id) {
    throw settlementError('Unexpected atomic payment settlement result');
  }
  return outcome;
}

app.post('/webhooks/paystack', async (req, res) => {
  if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Payment webhook not configured.' });
  const signature = req.headers['x-paystack-signature'];
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody || '').digest('hex');
  const actualBuffer = Buffer.from(typeof signature === 'string' ? signature : '');
  const expectedBuffer = Buffer.from(expected);
  if (!signature || actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Invalid Paystack webhook signature.' });
  }

  try {
    const event = req.body || {};
    if (event.event !== 'charge.success') return res.json({ received: true, ignored: true });
    if (event.data?.status !== 'success') {
      return res.status(422).json({ error: 'Charge event was not successful' });
    }
    const result = await recordSuccessfulPayment(event.data.reference, event.data);
    if (result.outcome === 'review_required') return res.status(202).json({ received: true, outcome: 'review_required' });
    return res.json({ received: true, outcome: result.outcome });
  } catch (error) {
    console.error('Paystack settlement error:', error.message);
    return res.status(error.status || 503).json({
      error: error.status === 422 || error.status === 400
        ? error.message : 'Payment settlement is temporarily unavailable',
    });
  }
});

// Verification reports committed settlement only; it never mutates plans
// and cannot turn a redirect into an independently confirmed payment.
app.get('/verify-paystack/:reference', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database unavailable' });
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!bearer) return res.status(401).json({ error: 'Sign in required' });
    const { data: auth, error: authError } = await supabase.auth.getUser(bearer[1]);
    if (authError || !auth?.user) return res.status(401).json({ error: 'Invalid session' });
    const reference = req.params.reference;
    if (!PAYSTACK_REFERENCE_PATTERN.test(reference)) {
      return res.status(400).json({ error: 'Invalid reference' });
    }
    const { data: attempt, error: attemptError } = await supabase.from('checkout_attempts')
      .select('business_id,provider,provider_reference,provider_transaction_id,expected_amount,currency,customer_email,status')
      .eq('provider', 'paystack').eq('provider_reference', reference)
      .eq('business_id', auth.user.id).maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt) return res.status(404).json({ error: 'Payment reference not found' });
    if (attempt.status === 'review_required' || attempt.status === 'expired') {
      return res.json({ verified: false, status: attempt.status, requiresReview: true });
    }
    if (attempt.status === 'failed') return res.json({ verified: false, status: 'failed' });
    // A missed webhook is recovered by consulting Paystack and using the
    // exact same atomic settlement RPC as the webhook.
    if (!process.env.PAYSTACK_SECRET_KEY) throw settlementError('Payment verification unavailable');
    const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw settlementError('Paystack verification unavailable');
    const provider = await response.json();
    if (provider.data?.reference !== reference) throw settlementError('Provider reference mismatch', 422);
    if (['pending','ongoing'].includes(provider.data?.status)) {
      return res.json({ verified: false, status: 'pending' });
    }
    if (provider.data?.status !== 'success') return res.json({ verified: false, status: 'failed' });
    const payment = parseVerifiedPaystackTransaction(provider, reference);
    if (!paymentMatchesAttempt(payment, attempt)) throw settlementError('Payment integrity mismatch', 422);
    const { data: rows, error: rpcError } = await supabase.rpc('settle_paystack_payment', payment);
    if (rpcError) throw rpcError;
    const settled = Array.isArray(rows) ? rows[0] : rows;
    if (!settled || settled.settled_business_id !== auth.user.id) throw settlementError('Settlement result mismatch');
    if (settled.outcome === 'review_required') return res.json({ verified: false, status: 'review_required', requiresReview: true });
    if (!['settled','already_settled'].includes(settled.outcome)) throw settlementError('Invalid settlement result');
    const { data: invoice, error: invoiceError } = await supabase.from('invoices')
      .select('business_id,status').eq('provider','paystack').eq('provider_reference',reference)
      .eq('business_id',auth.user.id).maybeSingle();
    if (invoiceError || invoice?.status !== 'paid') throw settlementError('Settled invoice missing or invalid');
    return res.json({ verified: true, status: 'paid' });
  } catch (error) {
    console.error('Paystack verification error:', error.message);
    return res.status(error.status || 503).json({ error: 'Unable to verify transaction' });
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
