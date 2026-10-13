import crypto from "node:crypto";

const PLAN_SEATS = { Professional: 3, Business: Infinity };
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function failure(status, message) { return Object.assign(new Error(message),{status}); }
function handler(fn) {
  return (req,res) => Promise.resolve().then(() => fn(req,res)).catch(error => {
    console.error("Staff access error:",error.message);
    if (!res.headersSent) res.status(error.status || 503).json({
      error: error.status && error.status < 500 ? error.message : "Staff service temporarily unavailable",
    });
  });
}
async function session(req, db) {
  if (!db) throw failure(503,"Database unavailable");
  const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization || "");
  if (!bearer) throw failure(401,"Sign in required");
  const {data,error} = await db.auth.getUser(bearer[1]);
  if (error || !data?.user) throw failure(401,"Invalid session");
  return data.user;
}
async function ensurePremium(db,businessId) {
  const { data: profile, error } = await db.from("profiles")
    .select("id,plan,payment_status,business").eq("id",businessId).maybeSingle();
  if (error) throw failure(503,"Business lookup unavailable");
  if (!profile) throw failure(404,"Business missing");
  const {data:entitled,error:accessError} = await db.rpc("has_current_paid_entitlement",{p_business_id:businessId});
  if (accessError) throw failure(503,"Entitlement unavailable");
  if (!entitled || !Object.hasOwn(PLAN_SEATS,profile.plan)) throw failure(403,"Active premium subscription required");
  return profile;
}
async function owner(req,db) {
  const user = await session(req,db);
  const profile = await ensurePremium(db,user.id);
  return {user,profile};
}
async function myMemberships(db,userId) {
  const {data,error} = await db.from("business_staff_memberships")
    .select("id,business_id,role,status").eq("user_id",userId).eq("status","active").limit(30);
  if (error) throw failure(503,"Membership lookup unavailable");
  const valid = [];
  for (const membership of data || []) {
    try {
      const profile = await ensurePremium(db,membership.business_id);
      valid.push({businessId:profile.id,business:profile.business,plan:profile.plan,role:membership.role});
    } catch (err) {
      if (err.status === 503) throw err;
      // Expired or removed business membership cannot authorize a staff session.
    }
  }
  return valid;
}
export function attachStaffRoutes(app, db) {
  app.get("/staff/me",handler(async(req,res) => {
    const user = await session(req,db);
    const memberships = await myMemberships(db,user.id);
    if (!memberships.length) throw failure(404,"No active staff membership");
    const selected = typeof req.query.businessId === "string"
      ? memberships.find(row => row.businessId === req.query.businessId) : null;
    if (req.query.businessId && !selected) throw failure(403,"Business membership not authorized");
    if (!selected && memberships.length > 1) return res.status(409).json({
      error:"Choose a business",code:"STAFF_BUSINESS_SELECTION_REQUIRED",memberships,
    });
    return res.json({...selected || memberships[0],memberships});
  }));

  app.get("/staff/memberships",handler(async(req,res) => {
    const user = await session(req,db);
    return res.json({memberships:await myMemberships(db,user.id)});
  }));

  app.get("/staff",handler(async(req,res) => {
    const {profile} = await owner(req,db);
    const [members,invites] = await Promise.all([
      db.from("business_staff_memberships").select("id,invited_email,role,status,invited_at")
        .eq("business_id",profile.id).eq("status","active").order("invited_at",{ascending:false}),
      db.from("business_staff_invitations").select("id,email,role,status,created_at")
        .eq("business_id",profile.id).eq("status","pending").order("created_at",{ascending:false}),
    ]);
    if (members.error || invites.error) throw failure(503,"Staff listing unavailable");
    return res.json({staff:[
      ...(members.data||[]).map(m=>({id:m.id,email:m.invited_email,role:m.role,status:m.status,invited_at:m.invited_at})),
      ...(invites.data||[]).map(m=>({id:m.id,email:m.email,role:m.role,status:"pending",invited_at:m.created_at})),
    ]});
  }));

  app.post("/staff/invite",handler(async(req,res) => {
    const {user,profile} = await owner(req,db);
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const role = req.body?.role === "manager" ? "manager" : "agent";
    if (email.length > 254 || !MAIL.test(email)) throw failure(400,"Valid staff email required");
    if (email === user.email?.toLowerCase()) throw failure(400,"An owner cannot invite themself");
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const {data:invitationId,error:saveError}=await db.rpc("create_staff_invitation",{
      p_business_id:profile.id,p_invited_by:user.id,p_email:email,p_role:role,p_token_hash:hash,
    });
    if(saveError) {
      if(saveError.code==="P0001")throw failure(403,"Staff seat limit reached");
      if(saveError.code==="23505")throw failure(409,"Staff member already invited or active");
      throw failure(503,"Could not persist staff invitation");
    }
    const {data:invitation,error:lookupError}=await db.from("business_staff_invitations")
      .select("id,email,created_at").eq("id",invitationId).eq("business_id",profile.id).single();
    if(lookupError||!invitation)throw failure(503,"Staff invitation could not be confirmed");
    const base = new URL(process.env.APP_URL || "http://localhost:5173");
    base.searchParams.set("staff_invite",token);
    const inviteUrl = base.toString();
    let inviteSent = false;
    try {
      const {error:inviteError} = await db.auth.admin.inviteUserByEmail(email,{redirectTo:inviteUrl});
      if (!inviteError) inviteSent = true;
      else if (!/already|registered|exists/i.test(inviteError.message || "")) {
        console.error("Supabase invite delivery unavailable:",inviteError.message);
      }
    } catch (error) {
      console.error("Staff invitation email unavailable:",error.message);
    }
    return res.status(201).json({
      staffMember:{id:invitation.id,email:invitation.email,role,status:"pending",invited_at:invitation.created_at},
      inviteSent,inviteUrl,
    });
  }));

  app.post("/staff/accept",handler(async(req,res) => {
    const user = await session(req,db);
    if (!user.email_confirmed_at) throw failure(403,"Confirm your email first");
    const token = req.body?.token;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw failure(400,"Invalid invitation");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const {data:memberId,error} = await db.rpc("accept_staff_invitation",{
      p_token_hash:hash,p_user_id:user.id,p_email:user.email,
    });
    if (error) throw failure(403,"Invitation invalid, expired, or already accepted");
    return res.json({membershipId:memberId});
  }));

  app.delete("/staff/:id",handler(async(req,res) => {
    const {profile} = await owner(req,db);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw failure(400,"Invalid staff record");
    const {data:membership,error:findError} = await db.from("business_staff_memberships")
      .select("id").eq("id",req.params.id).eq("business_id",profile.id).maybeSingle();
    if (findError) throw failure(503,"Staff lookup unavailable");
    if (membership) {
      const {error} = await db.from("business_staff_memberships")
        .update({status:"revoked",revoked_at:new Date().toISOString()})
        .eq("id",membership.id).eq("business_id",profile.id);
      if (error) throw failure(503,"Unable to revoke staff membership");
      return res.status(204).end();
    }
    const {error} = await db.from("business_staff_invitations").update({status:"revoked"})
      .eq("id",req.params.id).eq("business_id",profile.id).eq("status","pending");
    if (error) throw failure(503,"Unable to revoke invitation");
    return res.status(204).end();
  }));
}
