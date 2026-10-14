// Explicit network fixtures exercise the real React application. These are not
// provider E2E tests and are never imported by application source.
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const STAFF = '22222222-2222-4222-8222-222222222222';
const token = id => `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:1999999999})).toString('base64url')}.test-signature`;
export function sessionFor(id = OWNER) {
  return { access_token:token(id),refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,expires_at:1999999999,
    user:{id,email:'owner@example.test',aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-10-01T00:00:00Z',user_metadata:{},app_metadata:{},identities:[]} };
}
export const profile = {
  id:OWNER,name:'Stephen',business:'Bloom & Co. Salon',business_type:'Salon & Beauty',description:'Haircuts and colour appointments.',
  service_name:'Cut and colour',price:'NGN 15000',hours:'Monday 09:00–17:00',hours_json:[{day:'Monday',open:'09:00',close:'17:00',closed:false}],
  timezone:'Africa/Lagos',address:'20 Market Street',city_state_zip:'Lagos',plan:'Professional',billing_period:'monthly',currency:'NGN',payment_status:'active',
  contact_phone:'+2348000000000',public_contact_email:'hello@example.test',assistant_name:'Bloom Assistant',tone:'Friendly & warm',greeting:'How can we help?',
};
export async function setupApp(page, { signedIn = true, staff = false, empty = false, fail = '', payment = 'pending', failWrites = false, trial = false } = {}) {
  const data = {
    profiles:[{...profile}], subscriptions:[{plan:'Professional',billing_period:'monthly',status:'active',current_period_end:'2030-01-01T00:00:00Z',cancel_at_period_end:false}],
    services:empty ? [] : [{id:'service-1',name:'Cut and colour',price:'NGN 15000',duration:'60 min'}],
    faqs:empty ? [] : [{id:'faq-1',question:'Are you open on Mondays?',answer:'Monday, 09:00 to 17:00.'}],
    conversations:empty ? [] : [
      {id:'message-1',customer_message:'Can I book a haircut?',ai_reply:'You can request an appointment for staff review.',escalated:false,booking_intent:true,created_at:new Date().toISOString()},
      {id:'message-2',customer_message:'I need a refund',ai_reply:'Please contact staff directly about your refund.',escalated:true,created_at:new Date().toISOString()},
    ],
    bookings:empty ? [] : [{id:'booking-1',customer_name:'Ada',customer_contact:'ada@example.test',service:'Cut and colour',booking_date:'2026-10-20',booking_time:'09:00',status:'pending',created_at:new Date().toISOString()}],
    invoices:empty ? [] : [{id:'invoice-1',amount:1500000,currency:'NGN',plan:'Professional',billing_period:'monthly',status:'paid',created_at:new Date().toISOString()}],
  };
  if (trial) { Object.assign(data.profiles[0], {plan:'14-day trial',payment_status:'trial',trial_active:true,trial_ends_at:'2030-01-01T00:00:00Z'}); data.subscriptions=[]; }
  for (const [table, rows] of Object.entries(data)) if (table !== "profiles") data[table] = rows.map(row => ({...row,business_id:OWNER}));
  const writes=[]; const session=sessionFor(staff ? STAFF : OWNER);
  if (signedIn) await page.addInitScript(value => localStorage.setItem('sb-ezeji-test-auth-token',JSON.stringify(value)),session);
  await page.route('https://fonts.googleapis.com/**',route => route.abort());
  await page.route('https://ezeji-test.supabase.co/**',async route => {
    const req=route.request(); const url=new URL(req.url()); const table=url.pathname.split('/').pop();
    const headers={ 'content-type':'application/json','access-control-allow-origin':'*','access-control-expose-headers':'content-range' };
    if (req.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if (url.pathname.includes('/auth/v1/')) {
      if (table==='logout') return route.fulfill({status:204,headers});
      if (table==='signup') { writes.push({table,body:req.postDataJSON()}); return route.fulfill({json:{...session.user,identities:[{id:OWNER}]},headers}); }
      if (table==='user') return route.fulfill({json:session.user,headers});
      if (table==='token' || table==='verify') return route.fulfill({json:session,headers});
      return route.fulfill({json:{},headers});
    }
    if (fail===table) return route.fulfill({status:503,json:{message:'Test database unavailable'},headers});
    let rows=staff && table==='profiles' ? [] : (data[table] || []);
    if (req.method()==='POST') { const body=req.postDataJSON(); const row={...body,id:`${table}-${rows.length+1}`}; rows.push(row); writes.push({table,body}); return route.fulfill({json:row,headers}); }
    if (req.method()==='DELETE' || req.method()==='PATCH') {
      if (failWrites) return route.fulfill({status:403,json:{message:'Write denied by test policy'},headers});
      const id=url.searchParams.get('id')?.replace('eq.',''); const row=rows.find(row=>row.id===id);
      writes.push({table,id,method:req.method(),body:req.method()==='PATCH'?req.postDataJSON():null});
      if (req.method()==='DELETE') data[table]=rows.filter(row=>row.id!==id);
      else if(row) Object.assign(row,req.postDataJSON());
      return route.fulfill({json:row?[row]:[],headers});
    }
    for (const [key,value] of url.searchParams) if(value.startsWith('eq.')) rows=rows.filter(row=>String(row[key])===value.slice(3));
    if (req.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'content-range':`0-${Math.max(0,rows.length-1)}/${rows.length}`}});
    const offset=Number(req.headers().range?.split('-')[0]||url.searchParams.get('offset')||0);
    if (offset) rows=[];
    return route.fulfill({json:rows,headers:{...headers,'content-range':`0-${Math.max(0,rows.length-1)}/${rows.length}`}});
  });
  await page.route('http://127.0.0.1:5174/**',async route => {
    const req=route.request(); const path=new URL(req.url()).pathname;
    if(path.startsWith('/public-business/'))return route.fulfill({json:{business:{id:OWNER,business:profile.business},faqs:data.faqs,services:data.services}});
    if(path==='/staff/me')return route.fulfill({json:{businessId:OWNER,business:profile.business,plan:'Professional',role:'agent'}});
    if(path==='/staff')return route.fulfill({json:{staff:[]}});
    if(path==='/owner/ai-usage')return route.fulfill({json:{periodKey:'2026-10',consumed:52,reserved:1}});
    if(path==='/integrations/whatsapp')return route.fulfill({json:{connection:null}});
    if(path.startsWith('/verify-paystack/'))return route.fulfill({json:{verified:payment==='paid',status:payment}});
    if(path==='/assistant-preview') { writes.push({path,body:req.postDataJSON(),authorization:req.headers().authorization}); return route.fulfill({json:{reply:'Your saved hours are Monday, 09:00 to 17:00.',preview:true,provider:'groq'}}); }
    return route.fulfill({status:503,json:{error:'Unconfigured test endpoint'}});
  });
  return { data, writes };
}
