import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';
import {createAssistantService} from '../server/assistantService.js';
import {createGroqClient} from '../server/groqClient.js';
import {createWhatsAppProcessor} from '../server/whatsappProcessor.js';
import {reconcileAssistantRequests} from '../server/assistantMaintenance.js';
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','WHATSAPP_TOKEN_ENCRYPTION_KEY','GROQ_API_KEY'])if(!process.env[key])throw new Error(`Missing WhatsApp worker setting: ${key}`);
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const assistant=createAssistantService({db,generate:createGroqClient()});
const processEvent=createWhatsAppProcessor({db,assistant});
let running=true;process.on('SIGTERM',()=>{running=false});process.on('SIGINT',()=>{running=false});
let lastRecovery=0;
while(running) {
 try {
  if(Date.now()-lastRecovery>60000){await reconcileAssistantRequests(db);lastRecovery=Date.now();}
  const {data:events,error}=await db.rpc('claim_whatsapp_events',{p_limit:1});
  if(error)throw new Error('Worker claim unavailable');
  for(const event of events||[]) {
   try{await processEvent(event);}catch(e){
    console.error(JSON.stringify({event:'whatsapp_processing_failed',correlationId:event.id,code:e.code||'processing_failed'}));
    const terminal=event.attempts>=5;
    const updated=await db.from('whatsapp_events').update({status:terminal?'dead':'queued',lease_until:null,
     last_error:terminal?'Retry limit exhausted':'Temporary processing failure',next_attempt_at:new Date(Date.now()+Math.min(300000,2000*2**event.attempts)).toISOString()})
     .eq('id',event.id).eq('status','processing').eq('attempts',event.attempts).select('id');
    if(updated.error||updated.data?.length!==1)console.error(JSON.stringify({event:'whatsapp_lease_update_failed',correlationId:event.id}));
   }
  }
 }catch{console.error(JSON.stringify({event:'whatsapp_worker_unavailable'}));}
 if(running)await new Promise(resolve=>setTimeout(resolve,2500));
}
