import React,{useEffect,useState,useRef} from 'react';
import {workspaceApi} from './workspaceApi';
import {StatusBadge} from './ui';
export function AssistantInbox({businessId}) {
 return <AssistantInboxSession key={businessId} businessId={businessId}/>;
}
function AssistantInboxSession({businessId}) {
 const [threads,setThreads]=useState([]),[selected,setSelected]=useState(null),[messages,setMessages]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[threadLoading,setThreadLoading]=useState(false);
 const generation=useRef(0),busyRef=useRef(false);
 useEffect(()=>{let active=true;workspaceApi(`/assistant-inbox/${businessId}`).then(data=>{if(active)setThreads(data.threads);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;generation.current++;};},[businessId]);
 const select=async(thread)=>{
  const current=++generation.current;setSelected(thread);setMessages([]);setError('');setThreadLoading(true);
  try{const data=await workspaceApi(`/assistant-inbox/${businessId}/${thread.id}`);if(data.thread?.id!==thread.id||data.thread.business_id!==businessId)throw new Error('Conversation response could not be verified.');if(current===generation.current){setSelected({...thread,...data.thread});setMessages(data.messages);}}
  catch(e){if(current===generation.current)setError(e.message);}finally{if(current===generation.current)setThreadLoading(false);}
 };
 const handoff=async(status)=>{
  if(busyRef.current||threadLoading||!selected)return;busyRef.current=true;setBusy(true);const current=generation.current;
  try{const data=await workspaceApi(`/assistant-inbox/${businessId}/${selected.id}`,{method:'PATCH',body:JSON.stringify({status})});if(data.status!==status)throw new Error('Handoff change was not verified.');if(current===generation.current){setSelected(v=>({...v,status:data.status}));setThreads(v=>v.map(t=>t.id===selected.id?{...t,status:data.status}:t));}}
  catch(e){if(current===generation.current)setError(e.message);}finally{if(current===generation.current){busyRef.current=false;setBusy(false);}}
 };
 return <section className="panel" aria-label="Conversation handoff inbox"><h2 className="panel-title">Live conversation records</h2><p className="panel-help">Review the latest 50 customer sessions and manage staff handoff. This inbox does not send staff messages; use the business’s supported contact channels.</p>
 {error&&<p className="auth-error" role="alert">{error}</p>}
 {loading&&<p className="panel-help" role="status">Loading customer sessions...</p>}
 {!loading&&!threads.length&&!error&&<p className="panel-help">No customer sessions have been recorded yet.</p>}
 {!!threads.length&&<div className="convo-layout"><div className="convo-list">{threads.map(t=><button className="convo-item" key={t.id} disabled={busy} onClick={()=>select(t)} aria-pressed={selected?.id===t.id}><span>{t.channel} · {new Date(t.updated_at).toLocaleString()}<small className="convo-preview">{t.escalation_reason||'Customer conversation'}</small></span><StatusBadge status={t.status}/></button>)}</div>
 {selected&&<div className="convo-thread"><h3 className="panel-title">{selected.channel} conversation</h3><p role="status">Status: {selected.status}</p><div className="page-actions"><button className="btn btn--outline" disabled={busy||threadLoading||selected.status==='opted_out'} onClick={()=>handoff('human')}>Pause automation for staff</button><button className="btn btn--outline" disabled={busy||threadLoading||selected.status==='opted_out'} onClick={()=>handoff('resolved')}>Mark resolved</button><button className="btn btn--amber" disabled={busy||threadLoading||selected.status==='opted_out'} onClick={()=>handoff('automated')}>Return to assistant</button></div>
 {threadLoading&&<p role="status">Loading conversation...</p>}
 {messages.map(m=><div key={m.id} className={`chat-bubble ${m.role==='user'?'chat-bubble--customer':'chat-bubble--ai'}`}><small>{m.role==='user'?'Customer':m.role==='staff'?'Staff':'Assistant'} · {m.delivery_status}</small><p>{m.content}</p></div>)}</div>}</div>}
 </section>;
}
