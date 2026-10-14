import React,{useEffect,useState,useRef} from 'react';
import {workspaceApi} from './workspaceApi';
import {StatusBadge} from './ui';
export function AssistantInbox({businessId}) {
 const [threads,setThreads]=useState([]),[selected,setSelected]=useState(null),[messages,setMessages]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 useEffect(()=>{let active=true;workspaceApi(`/assistant-inbox/${businessId}`).then(data=>{if(active)setThreads(data.threads);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;generation.current++;};},[businessId]);
 const select=async(thread)=>{
  const current=++generation.current;setSelected(thread);setMessages([]);setError('');
  try{const data=await workspaceApi(`/assistant-inbox/${businessId}/${thread.id}`);if(current===generation.current){setSelected({...thread,...data.thread});setMessages(data.messages);}}
  catch(e){if(current===generation.current)setError(e.message);}
 };
 const handoff=async(status)=>{
  if(busy||!selected)return;setBusy(true);const current=generation.current;
  try{const data=await workspaceApi(`/assistant-inbox/${businessId}/${selected.id}`,{method:'PATCH',body:JSON.stringify({status})});if(current===generation.current){setSelected(v=>({...v,status:data.status}));setThreads(v=>v.map(t=>t.id===selected.id?{...t,status:data.status}:t));}}
  catch(e){if(current===generation.current)setError(e.message);}finally{if(current===generation.current)setBusy(false);}
 };
 return <section className="panel" aria-label="Conversation handoff inbox"><h2 className="panel-title">Live conversation records</h2><p className="panel-help">Review the latest 50 customer sessions and manage staff handoff. This inbox does not send staff messages; use the business’s supported contact channels.</p>
 {error&&<p className="auth-error" role="alert">{error}</p>}
 {!threads.length&&!error&&<p className="panel-help">No customer sessions have been recorded yet.</p>}
 {!!threads.length&&<div className="convo-layout"><div className="convo-list">{threads.map(t=><button className="convo-item" key={t.id} onClick={()=>{setBusy(false);select(t);}} aria-pressed={selected?.id===t.id}><span>{t.channel} · {new Date(t.updated_at).toLocaleString()}<small className="convo-preview">{t.escalation_reason||'Customer conversation'}</small></span><StatusBadge status={t.status}/></button>)}</div>
 {selected&&<div className="convo-thread"><h3 className="panel-title">{selected.channel} conversation</h3><p role="status">Status: {selected.status}</p><div className="page-actions"><button className="btn btn--outline" disabled={busy||selected.status==='opted_out'} onClick={()=>handoff('human')}>Pause automation for staff</button><button className="btn btn--outline" disabled={busy||selected.status==='opted_out'} onClick={()=>handoff('resolved')}>Mark resolved</button><button className="btn btn--amber" disabled={busy||selected.status==='opted_out'} onClick={()=>handoff('automated')}>Return to assistant</button></div>
 {messages.map(m=><div key={m.id} className={`chat-bubble ${m.role==='user'?'chat-bubble--customer':'chat-bubble--ai'}`}><small>{m.role==='user'?'Customer':m.role==='staff'?'Staff':'Assistant'} · {m.delivery_status}</small><p>{m.content}</p></div>)}</div>}</div>}
 </section>;
}
