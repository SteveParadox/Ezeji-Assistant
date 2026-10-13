import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { attachStaffRoutes } from './server/staffRoutes.js';
import { ensureOwnerBusiness } from './server/businessProvisioning.js';
import { newPaystackReference, PAYSTACK_REFERENCE_PATTERN, parseVerifiedPaystackTransaction, paymentMatchesAttempt, isTrustedPaystackCheckoutUrl } from './server/paystackSettlement.js';
import { attachWhatsAppRoutes } from './server/whatsappConnections.js';
import { attachAssistantPreviewRoute } from './server/assistantPreview.js';
import { serviceDurationMinutes, validateBookingWindow } from './server/bookingValidation.js';

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
      max_tokens: Math.min(1000, Number(process.env.GROQ_MAX_REPLY_TOKENS) || 500),
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

// Narrow public storefront endpoint: customers can obtain public-facing facts
// by business UUID, never full profiles or private tenant records.
app.get('/public-business/:businessId', async (req,res) => {
  try {
    const businessId=req.params.businessId;
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(businessId)) {
      return res.status(400).json({error:'Invalid business identifier'});
    }
    if(!supabase)return res.status(503).json({error:'Public business information unavailable'});
    const [profile,faqs,services]=await Promise.all([
      supabase.from('profiles')
        .select('id,business,business_type,custom_business_type,service_name,price,hours,description,timezone,contact_phone,public_contact_email,website')
        .eq('id',businessId).maybeSingle(),
      supabase.from('faqs').select('question,answer').eq('business_id',businessId).limit(60),
      supabase.from('services').select('id,name,price,duration').eq('business_id',businessId).limit(60),
    ]);
    if(profile.error||faqs.error||services.error)throw profile.error||faqs.error||services.error;
    if(!profile.data)return res.status(404).json({error:'Business unavailable'});
    return res.json({business:{
      id:profile.data.id,business:profile.data.business,
      businessType:profile.data.business_type,customBusinessType:profile.data.custom_business_type,
      serviceName:profile.data.service_name,price:profile.data.price,
      hours:profile.data.hours,description:profile.data.description,
      timezone:profile.data.timezone,
      phone:profile.data.contact_phone,
      contactEmail:profile.data.public_contact_email,
      website:profile.data.website,
    },faqs:faqs.data||[],services:services.data||[]});
  }catch(error){
    console.error('Public business lookup error',error.message);
    return res.status(503).json({error:'Business information temporarily unavailable'});
  }
});

app.post('/assistant-reply', async (req,res)=>{
  let reservedId = null;
  try {
    const {message,businessId,conversation,requestId}=req.body||{};
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
    const idempotencyKey = typeof requestId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(requestId)
      ? requestId : crypto.randomUUID();
    const periodKey = new Date().toISOString().slice(0,7);
    const profileUsage = await supabase.from('profiles')
      .select('plan').eq('id',businessId).maybeSingle();
    if (profileUsage.error || !profileUsage.data) throw new Error('Usage account unavailable');
    const {data: reservation, error:reserveError} = await supabase.rpc('reserve_ai_usage',{
      p_business_id:businessId,
      p_period_key:profileUsage.data.plan === '14-day trial' ? 'trial' : periodKey,
      p_idempotency_key:idempotencyKey,
    });
    if (reserveError) {
      if (reserveError.code === 'P0003') {
        return res.status(409).json({error:'This request was already accepted; do not submit it again.',code:'DUPLICATE_AI_REQUEST'});
      }
      if (reserveError.code === 'P0001' || reserveError.code === 'P0004' || reserveError.code === '42501') {
        return res.status(429).json({reply:'This business has exhausted its available AI usage.',provider:'limit-reached',limitReached:true});
      }
      throw reserveError;
    }
    reservedId = reservation;
    const p=prof.data;
    const systemPrompt=`You are a customer assistant for ${p.business}. Answer using only business facts provided below. Do not invent availability or claim any booking is confirmed. Booking requests must be confirmed by staff. Hours: ${p.hours||'Not provided'}. Description: ${p.description||''}. Services: ${JSON.stringify(services.data||[])}. FAQs: ${JSON.stringify(faq.data||[])}`;
    const result=await generateAssistantReply({message:message.trim(),profile:{business:p.business,serviceName:p.service_name,price:p.price,hours:p.hours},conversation:conversation||[],systemPrompt});
    if(result.provider==='groq') {
      const {error:writeError}=await supabase.from('conversations').insert({business_id:businessId,customer_message:message.trim(),ai_reply:result.reply,escalated:false,booking_intent:/book|reserve|appointment/i.test(message)});
      if(writeError) throw new Error('Conversation persistence unavailable');
    }
    const {error:finalError}=await supabase.rpc('finalize_ai_usage',{p_reservation_id:reservedId,p_success:result.provider==='groq'});
    if(finalError) throw finalError;
    reservedId=null;
    return res.json(result);
  } catch(error) {
    if(reservedId && supabase) {
      const {error:releaseError}=await supabase.rpc('finalize_ai_usage',{p_reservation_id:reservedId,p_success:false});
      if(releaseError) console.error('Usage reservation release error:',releaseError.message);
    }
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
    if(event.event === 'refund.processed') {
      const reference = event.data?.transaction_reference;
      const refundReference = event.data?.refund_reference;
      const amount = Number(event.data?.amount);
      if(!PAYSTACK_REFERENCE_PATTERN.test(reference||'')||
         typeof refundReference!=='string'||refundReference.length<5||
         !Number.isSafeInteger(amount)||amount<=0||event.data?.currency!=='NGN') {
        return res.status(422).json({error:'Refund payload requires reconciliation'});
      }
      const providerResponse = await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(reference),{
        headers:{Authorization:'Bearer '+process.env.PAYSTACK_SECRET_KEY},
        signal:AbortSignal.timeout(15000),
      });
      if(!providerResponse.ok) throw settlementError('Refund verification unavailable');
      const verified = await providerResponse.json();
      // Refund notifications are signed, but also confirm the original charge
      // is reversed before changing entitlements.
      if(verified?.data?.reference!==reference || verified?.data?.status!=='reversed') {
        throw settlementError('Refund not yet confirmed as reversed');
      }
      const {data:outcome,error:refundError}=await supabase.rpc('record_verified_paystack_refund',{
        p_reference:reference,p_refund_reference:refundReference,
        p_amount:amount,p_currency:'NGN',
      });
      if(refundError)throw refundError;
      return res.json({received:true,outcome});
    }
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
    if (attempt.status === 'review_required') {
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

// One-time paid terms do not automatically recur. This endpoint records a
// customer's instruction not to renew, without shortening paid access.
app.post('/subscriptions/cancel-at-period-end', async(req,res) => {
  try {
    if(!supabase)return res.status(503).json({error:'Billing database unavailable'});
    const bearer=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');
    if(!bearer)return res.status(401).json({error:'Sign in required'});
    const auth=await supabase.auth.getUser(bearer[1]);
    if(auth.error||!auth.data?.user)return res.status(401).json({error:'Invalid session'});
    const businessId=auth.data.user.id;
    const {data:sub,error:lookupError}=await supabase.from('subscriptions')
      .select('id,status,current_period_end').eq('business_id',businessId).maybeSingle();
    if(lookupError)throw lookupError;
    if(!sub||!['active','cancellation_scheduled'].includes(sub.status)||
      Date.parse(sub.current_period_end)<=Date.now()) {
      return res.status(409).json({error:'No active term can be canceled'});
    }
    const {data,error}=await supabase.from('subscriptions')
      .update({cancel_at_period_end:true,status:'cancellation_scheduled',updated_at:new Date().toISOString()})
      .eq('id',sub.id).eq('business_id',businessId).in('status',['active','cancellation_scheduled'])
      .select('current_period_end,cancel_at_period_end').maybeSingle();
    if(error||!data)throw error||new Error('Subscription changed concurrently');
    return res.json({cancelAtPeriodEnd:true,paidThrough:data.current_period_end});
  }catch(error){console.error('Subscription cancellation failed',error.message);
    return res.status(503).json({error:'Unable to change cancellation preference'});}
});

app.post('/booking-requests', async (req,res) => {
  try {
    if (!supabase) return res.status(503).json({error:'Booking database unavailable'});
    const {businessId,serviceId,customerName,customerContact,startAt,requestId} = req.body || {};
    if (![businessId,serviceId,requestId].every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id))) {
      return res.status(400).json({error:'Invalid booking identifiers'});
    }
    if (typeof customerName!=='string'||customerName.trim().length<2||customerName.length>120||
        typeof customerContact!=='string'||customerContact.trim().length<5||customerContact.length>160) {
      return res.status(400).json({error:'Customer name and contact are required'});
    }
    const [{data:business,error:profileError},{data:service,error:serviceError}] = await Promise.all([
      supabase.from('profiles').select('id,plan,trial_active,trial_ends_at,timezone,hours_json')
        .eq('id',businessId).maybeSingle(),
      supabase.from('services').select('id,name,duration').eq('id',serviceId).eq('business_id',businessId).maybeSingle(),
    ]);
    if(profileError||serviceError) throw profileError||serviceError;
    if(!business||!service) return res.status(404).json({error:'Business or service unavailable'});
    if (business.plan==='14-day trial') {
      if(!business.trial_active||Date.parse(business.trial_ends_at||'')<=Date.now()) {
        return res.status(403).json({error:'Business is not accepting bookings'});
      }
    } else {
      const {data:paid,error:paidError}=await supabase.rpc('has_current_paid_entitlement',{p_business_id:businessId});
      if(paidError) throw paidError;
      if(!paid) return res.status(403).json({error:'Business is not accepting bookings'});
    }
    const duration=serviceDurationMinutes(service.duration);
    if(!duration) return res.status(422).json({error:'Business must set a valid service duration before bookings are accepted'});
    let slot;
    try { slot=validateBookingWindow({
      startAt,durationMinutes:duration,
      timezone:business.timezone||'Africa/Lagos',hoursJson:business.hours_json,
    }); } catch(error) { return res.status(422).json({error:error.message}); }
    const {data:bookingId,error} = await supabase.rpc('create_pending_booking',{
      p_business_id:businessId,p_customer_name:customerName.trim(),
      p_customer_contact:customerContact.trim(),p_service_id:serviceId,
      p_start:slot.start,p_end:slot.end,p_timezone:slot.timezone,
      p_local_date:slot.localDate,p_local_time:slot.localTime,
      p_source:'web_chat',p_request_id:requestId,
    });
    if(error) throw error;
    return res.status(201).json({bookingId,status:'pending',message:'Booking request received. Staff confirmation is required.'});
  } catch(error) {
    console.error('Booking request error:',error.message);
    return res.status(503).json({error:'Unable to save booking request'});
  }
});

app.get('/health', (req,res) => res.json({status:'alive'}));
app.get('/health/ready', async(req,res)=>{
  if(!supabase)return res.status(503).json({status:'not_ready',reason:'database'});
  try {
    const {data,error}=await supabase.rpc('production_billing_ready');
    if(error||data!==true)throw new Error('required migrations unavailable');
    const {error:dbError}=await supabase.from('profiles').select('id',{head:true,count:'exact'}).limit(1);
    if(dbError)throw dbError;
    return res.json({status:'ready',database:'ready',billingMigrations:'ready',
      paystackConfigured:!!process.env.PAYSTACK_SECRET_KEY,
      aiConfigured:!!process.env.GROQ_API_KEY,
      whatsappWorker:'independent-service'});
  }catch(error){
    console.error('Dependency readiness failure',error.message);
    return res.status(503).json({status:'not_ready',reason:'dependencies'});
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

  // The previous handler acknowledged before writing anything durable.
  // Here every recognized event is committed before Meta gets HTTP 200.
  if (!supabase) return res.status(503).json({error:'Message persistence unavailable'});
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      for (const change of (Array.isArray(entry.changes) ? entry.changes : [])) {
        const value = change?.value;
        const phoneNumberId = String(value?.metadata?.phone_number_id || '');
        if (!/^\d{8,24}$/.test(phoneNumberId)) continue;
        const { data: connection, error: connectionError } = await supabase.from('channel_connections')
          .select('business_id').eq('channel','whatsapp').eq('phone_number_id',phoneNumberId).maybeSingle();
        if (connectionError) throw connectionError;
        if (!connection) continue;
        for (const message of (Array.isArray(value?.messages) ? value.messages : [])) {
          if (message?.type !== 'text' || !message?.id || !message?.from) continue;
          const text = String(message.text?.body || '').trim().slice(0,2000);
          if (!text) continue;
          const { error: persistedError } = await supabase.from('whatsapp_events').upsert({
            business_id:connection.business_id,
            provider_event_id:String(message.id),
            phone_number_id:phoneNumberId,
            sender_phone:String(message.from),
            customer_text:text,
            kind:'inbound',
            status:'queued',
          },{onConflict:'provider_event_id',ignoreDuplicates:true});
          if(persistedError) throw persistedError;
        }
        for (const receipt of (Array.isArray(value?.statuses) ? value.statuses : [])) {
          if(!receipt?.id || !['sent','delivered','read','failed'].includes(receipt.status)) continue;
          const statusEventId = 'status:' + receipt.id + ':' + receipt.status + ':' + String(receipt.timestamp || '');
          const {error:statusStoreError} = await supabase.from('whatsapp_events').upsert({
            business_id:connection.business_id,provider_event_id:statusEventId,
            phone_number_id:phoneNumberId,kind:'delivery_status',
            status:'queued',receipt_message_id:String(receipt.id),
            receipt_status:receipt.status,
            receipt_occurred_at:/^\d{9,12}$/.test(String(receipt.timestamp||''))
              ? new Date(Number(receipt.timestamp)*1000).toISOString() : null,
          },{onConflict:'provider_event_id',ignoreDuplicates:true});
          if(statusStoreError) throw statusStoreError;
          // Do not update outbox directly. The worker persists and applies
          // these receipts after provider acceptance, with monotonic ordering.
        }
      }
    }
    return res.sendStatus(200);
  } catch(error) {
    console.error('WhatsApp durable ingestion failed:',error.message);
    return res.status(503).json({error:'Webhook acceptance unavailable'});
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Nightline payment server listening on port ${port}`);
  });
}

attachStaffRoutes(app,supabase);

attachWhatsAppRoutes(app,supabase);
attachAssistantPreviewRoute(app, supabase, generateAssistantReply);

export default app;
