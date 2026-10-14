import React, { useEffect, useRef, useState } from "react";
import { buildOfflineFallbackReply } from "./assistantLogic";
import { buildChatSendPayload } from "./chatRequest";
import { Clock, Trash2, Send, X, MessageCircle, AlertTriangle, Mic, MicOff } from "lucide-react";
import { API_BASE_URL } from "./shared";
import { useConfirmation } from "./ui";
import { supabase } from "./supabaseClient";

export function ChatWidgetDemo(props) {
  return <ChatWidgetSession key={`${props.previewOnly===true?"preview":"web"}:${props.user?.id||"guest"}`} {...props}/>;
}
function ChatWidgetSession({ user, enabled = true, previewOnly = false }) {
  const confirm=useConfirmation();
  const storageScope=`${previewOnly?"preview":"customer"}-${user?.id||"guest"}`;
  const [open,setOpen]=useState(true),[draftState,setDraftState]=useState({scope:storageScope,value:""});
  const draft=draftState.scope===storageScope?draftState.value:"";
  const setDraft=value=>setDraftState(previous=>({scope:storageScope,value:typeof value==="function"?value(previous.scope===storageScope?previous.value:""):value}));
  const [messages,setMessages]=useState([]),[isTyping,setIsTyping]=useState(false),[isRestoring,setIsRestoring]=useState(false);
  const [connectionIssue,setConnectionIssue]=useState(false),[failure,setFailure]=useState(null);
  const [bookingNotice,setBookingNotice]=useState(""),[showBookingForm,setShowBookingForm]=useState(false);
  const [bookingBusy,setBookingBusy]=useState(false),[bookingReview,setBookingReview]=useState(false),[bookingUncertain,setBookingUncertain]=useState(false);
  const [booking,setBooking]=useState({name:"",contact:"",serviceId:"",startAt:"",requestId:crypto.randomUUID()});
  const [knowledge,setKnowledge]=useState({faqs:[],services:[]});
  const [currentTime,setCurrentTime]=useState(new Date()),[disappearing,setDisappearing]=useState(true);
  const [isListening,setIsListening]=useState(false),[voiceSupported,setVoiceSupported]=useState(false);
  const recognitionRef=useRef(null),requestGeneration=useRef(0),sendingRef=useRef(false),controller=useRef(null);
  const sessionRef=useRef(null),scrollRef=useRef(null),bookingRef=useRef(false);
  const bookingPendingKey=`ezeji-booking-pending-${storageScope}`;
  const getStorage=(kind,key)=>{try{return window[kind].getItem(key);}catch{return null;}};
  const sessionKey=`ezeji-session-${storageScope}`,draftKey=`ezeji-draft-${storageScope}`,pendingKey=`ezeji-pending-${storageScope}`;
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
  const greeting=()=>({id:crypto.randomUUID(),from:"ai",text:previewOnly?`Private preview for ${user?.business||"your business"}.`:`Welcome to ${user?.business||"this business"}. How can I help?`});
  const authHeaders=async()=>{
    const accessToken=previewOnly?(await supabase.auth.getSession()).data.session?.access_token:null;
    if(previewOnly&&!accessToken)throw new Error("Sign in to test your assistant.");
    return {"Content-Type":"application/json",...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})};
  };
  useEffect(()=>{
    const generation=++requestGeneration.current;
    controller.current?.abort();sendingRef.current=false;bookingRef.current=false;recognitionRef.current?.abort();
    setIsListening(false);setIsTyping(false);setIsRestoring(false);setFailure(null);setConnectionIssue(false);setBookingBusy(false);setBookingUncertain(false);setBooking({name:"",contact:"",serviceId:"",startAt:"",requestId:crypto.randomUUID()});setBookingNotice("");setShowBookingForm(false);setBookingReview(false);setKnowledge({faqs:[],services:[]});
    let stored=null,pending=null;
    try {
      stored=previewOnly?null:getStorage("localStorage",sessionKey)||getStorage("sessionStorage",sessionKey);
      pending=JSON.parse(getStorage("sessionStorage",pendingKey)||"null");
      setDraft(getStorage("sessionStorage",draftKey)||"");
      setDisappearing(previewOnly||!getStorage("localStorage",sessionKey));
    }catch{setDraft("");}
    sessionRef.current=/^[a-f0-9]{64}$/.test(stored||"")?stored:token();
    if(!previewOnly)try{sessionStorage.setItem(sessionKey,sessionRef.current);}catch{}
    setMessages([greeting()]);
    if(!previewOnly)try{const saved=JSON.parse(getStorage("sessionStorage",bookingPendingKey)||"null");if(saved?.businessId===user?.id&&saved.sessionToken===sessionRef.current&&typeof saved.requestId==="string"){
      const date=new Date(saved.startAt);const local=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
      setBooking({name:saved.customerName,contact:saved.customerContact,serviceId:saved.serviceId,startAt:local,requestId:saved.requestId});setShowBookingForm(true);setBookingReview(true);setBookingUncertain(true);setBookingNotice("An earlier booking submission has not been acknowledged. Retry the same reviewed request to retrieve its result.");
    }}catch{}
    if(pending?.sessionToken===sessionRef.current&&pending?.businessId===user?.id)setFailure(pending);
    const restore=new AbortController();
    if(user?.id&&stored){setIsRestoring(true);authHeaders().then(headers=>fetch(`${API_BASE_URL}/${previewOnly?"assistant-preview/session":"assistant-session"}/${encodeURIComponent(user.id)}`,{headers:{...headers,"X-Conversation-Token":stored},signal:restore.signal}))
      .then(async response=>{if(response.status===404)return null;if(!response.ok)throw new Error("History could not be restored. Retry your last message or start a new conversation.");return response.json();})
      .then(data=>{if(generation!==requestGeneration.current||!data)return;setMessages(data.messages.map(m=>({id:m.request_key?(m.role==="user"?m.request_key:`${m.request_key}-reply`):m.id,from:m.role==="user"?"customer":"ai",text:m.content,timestamp:m.created_at})));if(pending&&data.messages.some(m=>m.request_key===pending.requestId&&m.role==="assistant")){setFailure(null);try{sessionStorage.removeItem(pendingKey);}catch{}}})
      .catch(error=>{if(generation===requestGeneration.current&&error.name!=="AbortError"){setConnectionIssue(true);setBookingNotice(error.message);}}).finally(()=>{if(generation===requestGeneration.current)setIsRestoring(false);});}
    setVoiceSupported(Boolean(window.SpeechRecognition||window.webkitSpeechRecognition));
    return ()=>{requestGeneration.current++;controller.current?.abort();restore.abort();recognitionRef.current?.abort();};
    // State belongs to one channel and tenant; late work cannot cross that boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storageScope]);
  useEffect(()=>{const timer=setInterval(()=>setCurrentTime(new Date()),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{try{if(!previewOnly&&draftState.scope===storageScope)sessionStorage.setItem(draftKey,draft);}catch{}},[draft,draftKey,previewOnly,draftState.scope,storageScope]);
  useEffect(()=>{scrollRef.current?.scrollIntoView({block:"nearest",behavior:"auto"});},[messages,isTyping]);
  useEffect(()=>{
    if(!user?.id||previewOnly)return;const abort=new AbortController();
    fetch(`${API_BASE_URL}/public-business/${encodeURIComponent(user.id)}`,{signal:abort.signal}).then(r=>r.ok?r.json():Promise.reject())
      .then(data=>setKnowledge({faqs:data.faqs||[],services:data.services||[]})).catch(()=>{});
    return()=>abort.abort();
  },[user?.id,previewOnly]);
  const clearChat=(force=false)=>{
    if(force!==true&&(sendingRef.current||bookingRef.current||isRestoring))return;
    requestGeneration.current++;controller.current?.abort();sendingRef.current=false;
    sessionRef.current=token();
    try{sessionStorage.setItem(sessionKey,sessionRef.current);sessionStorage.removeItem(pendingKey);localStorage.removeItem(sessionKey);}catch{}
    setBookingUncertain(false);setShowBookingForm(false);setBookingReview(false);setBooking({name:"",contact:"",serviceId:"",startAt:"",requestId:crypto.randomUUID()});setMessages([greeting()]);setIsRestoring(false);setIsTyping(false);setFailure(null);setConnectionIssue(false);setBookingNotice("New conversation started. Earlier server records remain until deletion or expiry.");setDisappearing(true);
  };
  const deleteServerChat=async()=>{
    if(sendingRef.current||bookingRef.current||isRestoring||!user?.id)return;
    const before=requestGeneration.current;
    if(!await confirm({title:"Delete this server conversation?",description:"Chat messages will be deleted. Booking requests and usage records remain separate. This cannot be undone.",action:"Delete conversation"})||before!==requestGeneration.current||sendingRef.current||bookingRef.current)return;
    sendingRef.current=true;const generation=requestGeneration.current;
    try{
      const headers=await authHeaders();const response=await fetch(`${API_BASE_URL}/${previewOnly?"assistant-preview/session":"assistant-session"}/${encodeURIComponent(user.id)}`,{method:"DELETE",headers:{...headers,"X-Conversation-Token":sessionRef.current}});
      const data=await response.json();if(!response.ok||data.deleted!==true)throw new Error(data.error||"Deletion could not be verified.");
      if(generation!==requestGeneration.current)return;clearChat(true);setBookingNotice(data.notice);
    }catch(error){if(generation===requestGeneration.current)setBookingNotice(error.message);}finally{if(generation===requestGeneration.current)sendingRef.current=false;}
  };
  const toggleDeviceHistory=()=>setDisappearing(value=>{
    try{if(value)localStorage.setItem(sessionKey,sessionRef.current);else localStorage.removeItem(sessionKey);}catch{}
    return !value;
  });
  const send=async(text,retryPayload)=>{
    if(!enabled||sendingRef.current||bookingRef.current||isRestoring||!user?.id)return;
    const nextText=String(retryPayload?.message||text||draft||"").trim();if(!nextText||nextText.length>2000)return;
    sendingRef.current=true;const generation=requestGeneration.current;
    const payload=retryPayload||{...buildChatSendPayload(nextText,user,[],{},previewOnly),requestId:crypto.randomUUID(),sessionToken:sessionRef.current};
    setMessages(m=>m.some(item=>item.id===payload.requestId)?m:[...m,{id:payload.requestId,from:"customer",text:nextText,timestamp:new Date().toISOString()}]);
    setDraft("");setFailure(null);setConnectionIssue(false);setBookingNotice("");setIsTyping(true);controller.current=new AbortController();
    try{if(!previewOnly)sessionStorage.setItem(pendingKey,JSON.stringify(payload));}catch{}
    try{
      const response=await fetch(`${API_BASE_URL}/${previewOnly?"assistant-preview":"assistant-reply"}`,{method:"POST",headers:await authHeaders(),body:JSON.stringify(payload),signal:controller.current.signal});
      const data=await response.json();if(!response.ok||typeof data.reply!=="string"||!data.reply.trim())throw new Error(data.error||"No verified assistant reply was received.");
      if(generation!==requestGeneration.current)return;
      setMessages(m=>m.some(item=>item.id===`${payload.requestId}-reply`)?m:[...m,{id:`${payload.requestId}-reply`,from:"ai",text:data.reply,timestamp:new Date().toISOString()}]);
      if(data.bookingStatus==="pending")setBookingNotice(`Booking request ${data.bookingId} is pending staff confirmation.`);
      else if(data.bookingIntent)setBookingNotice("Booking requests require staff confirmation. No appointment has been reserved.");
      try{sessionStorage.removeItem(pendingKey);}catch{}
    }catch(error){
      if(generation!==requestGeneration.current||error.name==="AbortError")return;
      setConnectionIssue(true);setFailure(payload);setBookingNotice(error.message);
    }finally{if(generation===requestGeneration.current){sendingRef.current=false;setIsTyping(false);}}
  };

  const submitBookingRequest = async () => {
    if (bookingRef.current || sendingRef.current || isRestoring || !bookingReview || !user?.id || previewOnly) return;
    bookingRef.current = true;
    const generation = requestGeneration.current;
    setBookingBusy(true);
    setBookingNotice("");
    try {
      if (!booking.startAt) throw new Error("Choose a date and time.");
      const timestamp = new Date(booking.startAt);
      if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid appointment time.");
      const payload={businessId:user.id,sessionToken:sessionRef.current,confirmed:true,serviceId:booking.serviceId,customerName:booking.name,customerContact:booking.contact,startAt:timestamp.toISOString(),requestId:booking.requestId};
      try{sessionStorage.setItem(bookingPendingKey,JSON.stringify(payload));}catch{}
      const response = await fetch(`${API_BASE_URL}/assistant-booking-request`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
      });
      const result = await response.json().catch(()=>({}));
      if(generation!==requestGeneration.current)return;
      if (!response.ok || !['pending','confirmed','completed','rejected','canceled','no_show'].includes(result.status) || typeof result.bookingId!=="string" || !result.bookingId) {
        if([400,403,422].includes(response.status)){try{sessionStorage.removeItem(bookingPendingKey);}catch{}setBookingUncertain(false);setBooking(b=>({...b,requestId:crypto.randomUUID()}));}
        else setBookingUncertain(true);
        throw new Error(result.error || "Could not save booking request.");
      }
      if (generation !== requestGeneration.current) return;
      try{sessionStorage.removeItem(bookingPendingKey);}catch{}
      setBookingReview(false);setBookingUncertain(false);
      setBookingNotice(result.status==='pending'?"Your request has been saved for staff review. It is NOT a confirmed appointment.":`Your earlier booking request has saved status: ${result.status}.`);
      setShowBookingForm(false);
      setBooking({name:"",contact:"",serviceId:"",startAt:"",requestId:crypto.randomUUID()});
    } catch(error) {
      if (generation === requestGeneration.current) {if(error instanceof TypeError)setBookingUncertain(true);setBookingNotice(error.message || "Booking request failed.");}
    } finally {
      if (generation === requestGeneration.current) {bookingRef.current = false; setBookingBusy(false);}
    }
  };

  const toggleVoiceInput = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition || !enabled) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    const generation=requestGeneration.current;
    recognition.onresult = (event) => generation===requestGeneration.current && setDraft((current) => `${current}${current ? " " : ""}${event.results[0][0].transcript}`);
    recognition.onend = () => {if(generation===requestGeneration.current)setIsListening(false);};
    recognition.onerror = () => {if(generation===requestGeneration.current)setIsListening(false);};
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const quickReplies = [
    { label: "What are your hours?", reply: "What are your hours?" },
    { label: "How much is a service?", reply: "How much is a service?" },
    { label: "Book Saturday 9am", reply: "Book Saturday 9am" },
  ];

  const timeString = currentTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const businessInitial = (user?.business || "B").trim().charAt(0).toUpperCase();

  return (
    <div className="widget-demo-stage">
      <p className="widget-demo-caption">{previewOnly ? "Private assistant preview. Messages here do not create customer bookings or conversations." : "Customer web chat. Successful messages may be recorded by the business. Booking requests require staff confirmation."}</p>
      {open && (
        <div className="widget-panel">
          <div className="widget-header">
            <div className="widget-header-left">
              <div className="widget-header-avatar">{businessInitial}</div>
              <div>
                <p className="widget-header-name">{user?.business || "Your Business"}</p>
                <p className="widget-header-time mono">{timeString}</p>
              </div>
            </div>
            <div className="widget-header-right">
              <span className="widget-status">
                <span className="widget-status-dot" />
                <span className="widget-status-label mono">{previewOnly ? "Preview" : "Customer chat"}</span>
              </span>
              {!previewOnly && <button
                className={`icon-btn ${disappearing ? "icon-btn--active" : ""}`}
                onClick={toggleDeviceHistory}
                aria-label={disappearing ? "Stop storing messages on this device: on" : "Stop storing messages on this device: off"}
                aria-pressed={disappearing}
                title={disappearing ? "Device history: off" : "Device history: on"}
              >
                <Clock className="icon-btn-icon" />
              </button>}
              <button className="icon-btn" onClick={()=>clearChat()} disabled={isTyping||bookingBusy||isRestoring} aria-label="Start new conversation" title="Start new conversation">
                <Trash2 className="icon-btn-icon" />
              </button>
              <button className="icon-btn" aria-label="Close chat" onClick={() => setOpen(false)}><X className="icon-btn-icon" /></button>
            </div>
          </div>
          <div className="widget-body" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text">
            {connectionIssue && (
              <div className="widget-connection-warning">
                <AlertTriangle className="icon-btn-icon" />
                {buildOfflineFallbackReply("",user)}
              </div>
            )}
            {disappearing && !previewOnly && (
              <div className="widget-disappearing-note">
                Device history is off. This tab can restore the server conversation; closing it loses the session key. Chat content expires after 30 days. The business and AI provider process messages to answer enquiries.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.from === "customer" ? "chat-bubble--customer" : "chat-bubble--ai"} ${m.offline ? "chat-bubble--offline" : ""}`}>
                <span className="chat-message-text">{m.text}</span>{m.timestamp && <small className="chat-timestamp"><time dateTime={m.timestamp}>{new Date(m.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></small>}
              </div>
            ))}
            {isRestoring && <p role="status" className="panel-help">Restoring your conversation...</p>}
            {failure && <button className="btn btn--outline" onClick={()=>send(null,failure)} disabled={isTyping}>Retry last message</button>}
            <div ref={scrollRef} />
            {isTyping && (
              <div className="chat-bubble chat-bubble--ai chat-bubble--typing" role="status" aria-label="Assistant is processing your message">
                <span className="typing-dot" style={{ animationDelay: "0s" }} />
                <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
              </div>
            )}
            {bookingNotice && <div className="widget-booking-note">{bookingNotice}</div>}
            {showBookingForm && !previewOnly && (
              <div className="panel" style={{padding:12,marginTop:10}}>
                <p className="panel-title">Request an appointment</p>
                <p className="panel-help">Times are entered in your device timezone. Staff must confirm the request.</p>
                <input className="field-input" aria-label="Customer name" placeholder="Your name" disabled={bookingBusy||bookingUncertain} maxLength={120} value={booking.name}
                  onChange={e=>{setBookingReview(false);setBooking(b=>({...b,name:e.target.value}));}} />
                <input className="field-input" aria-label="Customer email or phone" placeholder="Email or phone" disabled={bookingBusy||bookingUncertain} maxLength={160} value={booking.contact}
                  onChange={e=>{setBookingReview(false);setBooking(b=>({...b,contact:e.target.value}));}} />
                <select disabled={bookingBusy||bookingUncertain} aria-label="Booking service" className="field-input" value={booking.serviceId}
                  onChange={e=>{setBookingReview(false);setBooking(b=>({...b,serviceId:e.target.value}));}}>
                  <option value="">Choose a service</option>
                  {knowledge.services.map(service=><option key={service.id} value={service.id}>
                    {service.name} ({service.duration || "duration not set"})
                  </option>)}
                </select>
                <input className="field-input" aria-label="Requested appointment date and time" type="datetime-local" disabled={bookingBusy||bookingUncertain} value={booking.startAt}
                  onChange={e=>{setBookingReview(false);setBooking(b=>({...b,startAt:e.target.value}));}} />
                {bookingUncertain && <p className="panel-help" role="status">The previous submission may have succeeded. Retry the unchanged request to verify its result before editing.</p>}
                {bookingReview && <p role="status" className="panel-help">Review: {booking.name}, {booking.contact}, {knowledge.services.find(s=>s.id===booking.serviceId)?.name}, {booking.startAt} (device timezone). Availability is not checked. Submission creates a pending request.</p>}
                <button className="btn btn--amber" disabled={bookingBusy||isTyping||isRestoring||!booking.serviceId||!booking.name||!booking.contact||!booking.startAt}
                  onClick={()=>bookingReview?submitBookingRequest():setBookingReview(true)}>{bookingBusy?"Submitting...":bookingReview?"Confirm and submit pending request":"Review booking request"}</button>
              </div>
            )}
          </div>
          <div className="widget-quick-replies">
            {!previewOnly && user?.id && (
              <button className="quick-reply" onClick={()=>setShowBookingForm(v=>!v)} disabled={!enabled}>
                {showBookingForm ? "Close request" : "Request appointment"}
              </button>
            )}
            {quickReplies.map((qr) => (
              <button key={qr.label} className="quick-reply" onClick={() => send(qr.reply)} disabled={!enabled||isTyping||bookingBusy||isRestoring}>{qr.label}</button>
            ))}
          </div>
          {!enabled && <p className="panel-help widget-paused-note">The assistant is paused. Turn it live to resume customer replies.</p>}
          <div className="widget-input-row">
            <button className={`widget-voice ${isListening ? "widget-voice--active" : ""}`} onClick={toggleVoiceInput} disabled={!enabled || !voiceSupported} aria-label={isListening ? "Stop recording" : "Record voice message"} title={isListening ? "Stop recording" : "Record voice message"}>
              {isListening ? <MicOff className="icon-btn-icon" /> : <Mic className="icon-btn-icon" />}
            </button>
            <textarea rows={2} maxLength={2000}
              aria-label="Message to assistant" className="field-input widget-input"
              placeholder="Type a message..."
              value={draft}
              disabled={!enabled}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button aria-label="Send message" className="widget-send" onClick={() => send()} disabled={!enabled||isTyping||bookingBusy||isRestoring||!draft.trim()}><Send className="icon-btn-icon" /></button>
          </div>
          {!previewOnly && <button className="quick-reply" disabled={isTyping||bookingBusy||isRestoring} onClick={deleteServerChat}>Delete this server conversation</button>}
        </div>
      )}
      {!open && (
        <button aria-label="Open chat" className="widget-bubble" onClick={() => setOpen(true)}>
          <MessageCircle className="icon-btn-icon" />
        </button>
      )}
    </div>
  );
}