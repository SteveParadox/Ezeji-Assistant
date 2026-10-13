import crypto from 'node:crypto';
const error=(code,message)=>Object.assign(new Error(message),{status:code});
function cipherKey(){
  const hex=process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY||'';
  if(!/^[a-f\d]{64}$/i.test(hex))throw error(503,'Encryption key missing');
  return Buffer.from(hex,'hex');
}
export function encryptToken(value){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',cipherKey(),iv);
  const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['enc-v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),bytes.toString('hex')].join(':');
}
export function decryptToken(value){
  const [format,iv,tag,data]=typeof value==='string'?value.split(':'):[];
  if(format!=='enc-v1'||!iv||!tag||!data)throw error(503,'Connection requires secure reconnection');
  const decipher=crypto.createDecipheriv('aes-256-gcm',cipherKey(),Buffer.from(iv,'hex'));
  decipher.setAuthTag(Buffer.from(tag,'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data,'hex')),decipher.final()]).toString();
}
async function business(req,db){
  if(!db)throw error(503,'Database unavailable');
  const match=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');
  if(!match)throw error(401,'Login required');
  const auth=await db.auth.getUser(match[1]);
  if(auth.error||!auth.data?.user)throw error(401,'Invalid session');
  const p=await db.from('profiles').select('id,plan,payment_status').eq('id',auth.data.user.id).maybeSingle();
  if(p.error||!p.data||!['Professional','Business'].includes(p.data.plan)||p.data.payment_status!=='active')throw error(403,'Active premium owner required');
  return p.data.id;
}
const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>res.status(e.status||503).json({error:e.status&&e.status<500?e.message:'Integration failed'}));
export function attachWhatsAppRoutes(app,db){
  app.get('/integrations/whatsapp',wrap(async(req,res)=>{
    const id=await business(req,db);
    const r=await db.from('channel_connections').select('phone_number_id').eq('business_id',id).eq('channel','whatsapp').maybeSingle();
    if(r.error)throw error(503,'Database unavailable');
    res.json({connection:r.data||null});
  }));
  app.put('/integrations/whatsapp',wrap(async(req,res)=>{
    const id=await business(req,db),number=String(req.body?.phoneNumberId||''),token=String(req.body?.accessToken||'');
    if(!/^\d{8,24}$/.test(number)||token.length<20||token.length>5000)throw error(400,'Invalid credentials');
    const result=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION||'v23.0'}/${number}?fields=display_phone_number`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
    if(!result.ok)throw error(400,'Meta rejected credentials');
    const info=await result.json();
    const r=await db.from('channel_connections').upsert({business_id:id,channel:'whatsapp',phone_number_id:number,access_token:encryptToken(token)},{onConflict:'business_id,channel'});
    if(r.error)throw error(503,'Unable to store connection');
    res.json({connection:{phone_number_id:number,displayPhoneNumber:info.display_phone_number||''}});
  }));
  app.delete('/integrations/whatsapp',wrap(async(req,res)=>{
    const id=await business(req,db);
    const r=await db.from('channel_connections').delete().eq('business_id',id).eq('channel','whatsapp');
    if(r.error)throw error(503,'Unable to disconnect');
    res.status(204).end();
  }));
}
