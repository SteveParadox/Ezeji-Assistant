// Tenant-scoped staff operations. Never trust a client-supplied business ID.
const ALLOWED = { Professional: 3, Business: Infinity };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function failure(status,message){const e=new Error(message);e.status=status;return e;}
async function session(req,db){
  if(!db)throw failure(503,'Database unavailable');
  const match=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');
  if(!match)throw failure(401,'Authentication required');
  const {data,error}=await db.auth.getUser(match[1]);
  if(error||!data?.user)throw failure(401,'Invalid session');
  return data.user;
}
async function owner(req,db){
  const user=await session(req,db);
  const {data,error}=await db.from('profiles').select('id,plan,payment_status').eq('id',user.id).maybeSingle();
  if(error||!data)throw failure(403,'Business owner access required');
  if(!Object.hasOwn(ALLOWED,data.plan)||data.payment_status!=='active')throw failure(403,'Active premium plan required');
  return {user,profile:data};
}
function route(fn){return (req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(error=>{
  console.error('staff route error',error.message);
  res.status(error.status||503).json({error:error.status&&error.status<500?error.message:'Staff service unavailable'});
});}
export function attachStaffRoutes(app,db){
  app.get('/staff/me',route(async(req,res)=>{
    const user=await session(req,db);
    const {data:staff,error}=await db.from('staff_members').select('business_id').ilike('email',user.email).limit(1).maybeSingle();
    if(error)throw failure(503,'Staff lookup unavailable');
    if(!staff)throw failure(404,'No staff membership');
    const {data:business,error:profileError}=await db.from('profiles').select('id,plan,payment_status').eq('id',staff.business_id).maybeSingle();
    if(profileError||!business || !Object.hasOwn(ALLOWED,business.plan)||business.payment_status!=='active')throw failure(403,'Staff business unavailable');
    res.json({businessId:business.id,plan:business.plan});
  }));
  app.get('/staff',route(async(req,res)=>{
    const {profile}=await owner(req,db);
    const {data,error}=await db.from('staff_members').select('id,email,invited_at').eq('business_id',profile.id).order('invited_at',{ascending:false});
    if(error)throw failure(503,'Staff listing unavailable');
    res.json({staff:data||[]});
  }));
  app.post('/staff/invite',route(async(req,res)=>{
    const {profile}=await owner(req,db);
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    if(email.length>254||!emailPattern.test(email))throw failure(400,'Invalid staff email');
    const {data:existing,error:lookupError}=await db.from('staff_members').select('id').eq('business_id',profile.id).ilike('email',email).maybeSingle();
    if(lookupError)throw failure(503,'Staff lookup unavailable');
    if(existing)throw failure(409,'Staff member already invited');
    const {count,error:countError}=await db.from('staff_members').select('id',{head:true,count:'exact'}).eq('business_id',profile.id);
    if(countError)throw failure(503,'Staff capacity unavailable');
    if((count||0)>=ALLOWED[profile.plan])throw failure(403,'Staff seat limit reached');
    const {data:record,error:insertError}=await db.from('staff_members').insert({business_id:profile.id,email}).select('id,email,invited_at').single();
    if(insertError)throw failure(409,'Unable to add staff member');
    let inviteSent=false;
    try {
      const {error:inviteError}=await db.auth.admin.inviteUserByEmail(email);
      if(!inviteError)inviteSent=true;
      else if(!/already registered|already exists/i.test(inviteError.message||''))throw inviteError;
    } catch(error) {
      await db.from('staff_members').delete().eq('id',record.id).eq('business_id',profile.id);
      throw failure(503,'Staff invitation could not be delivered');
    }
    res.status(201).json({staffMember:record,inviteSent});
  }));
  app.delete('/staff/:id',route(async(req,res)=>{
    const {profile}=await owner(req,db);
    const id=req.params.id;
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw failure(400,'Invalid staff identifier');
    const {error}=await db.from('staff_members').delete().eq('id',id).eq('business_id',profile.id);
    if(error)throw failure(503,'Unable to revoke staff access');
    res.status(204).end();
  }));
}
