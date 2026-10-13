// A zero-row conditional update is NOT a successful claim.
// This guards against two workers sending the same WhatsApp reply.
export async function claimQueuedOutbound(db,id,now=()=>new Date()) {
  if (!id) throw new Error("Outbound message identifier required");
  const {data,error}=await db.from("whatsapp_outbound_messages")
    .update({status:"sending",updated_at:now().toISOString()})
    .eq("id",id).eq("status","queued")
    .select("id").maybeSingle();
  if(error)throw error;
  return data?.id===id;
}
