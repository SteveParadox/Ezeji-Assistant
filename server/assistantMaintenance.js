export async function reconcileAssistantRequests(db,{logger=console}={}) {
  const {data:rows,error}=await db.from('assistant_requests').select('id').eq('status','generated').order('updated_at').limit(50);
  if(error)throw new Error('Assistant reconciliation unavailable');
  let recovered=0,failed=0;
  for(const row of rows||[]) {
    const result=await db.rpc('commit_assistant_reply',{p_request_id:row.id});
    if(result.error){failed++;logger.error?.('assistant.reconciliation_failed',{correlationId:row.id});}else recovered++;
  }
  const abandoned=await db.rpc('recover_abandoned_assistant_requests');
  if(abandoned.error)throw new Error('Abandoned request recovery unavailable');
  return {recovered,failed,reviewRequired:abandoned.data};
}
