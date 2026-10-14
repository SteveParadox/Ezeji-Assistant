import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';
import {reconcileAssistantRequests} from '../server/assistantMaintenance.js';
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])if(!process.env[key])throw new Error(`Missing ${key}`);
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
try {
 const result=await reconcileAssistantRequests(db);
 const prune=await db.rpc('prune_assistant_data');if(prune.error)throw new Error('Retention pruning failed');
 console.info(JSON.stringify({event:'assistant_maintenance',...result,pruned:prune.data}));
 if(result.failed)process.exitCode=1;
}catch{console.error(JSON.stringify({event:'assistant_maintenance_failed'}));process.exitCode=1;}
