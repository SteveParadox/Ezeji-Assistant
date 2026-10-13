import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { buildOfflineFallbackReply, buildAssistantRequestPayload } from "./assistantLogic";
import { Clock, Trash2, Send, X, MessageCircle, AlertTriangle, Mic, MicOff } from "lucide-react";
import { API_BASE_URL } from "./shared";

export function ChatWidgetDemo({ user, enabled = true, previewOnly = false }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [bookingNotice, setBookingNotice] = useState("");
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [booking, setBooking] = useState({name:"",contact:"",serviceId:"",startAt:"",requestId:crypto.randomUUID()});
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    setVoiceSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  // Every piece of widget state below is scoped to this specific business's
  // id (falling back to "guest" only when no user is loaded yet). Without
  // this, two different accounts signed into the same browser would read
  // and overwrite each other's chat history, booking requests, and settings
  // - a real data-leak bug, not just a cosmetic one.
  const storageScope = user?.id || "guest";
  const chatHistoryKey = `nightline-chat-history-${storageScope}`;
  const disappearingKey = `nightline-disappearing-messages-${storageScope}`;

  const [disappearing, setDisappearing] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(disappearingKey);
    if (stored !== null) return stored === "true";
    return user?.disappearingDefault !== false;
  });
  const [messages, setMessages] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(chatHistoryKey);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return [
      {
        from: "ai",
        text: user ? `Hi! I'm ${user.business || "your business"}'s assistant. Ask me about hours, pricing, or booking.` : "Hi! Ask me about hours, pricing, or booking.",
      },
    ];
  });

  // Re-load this business's own chat history whenever the logged-in account
  // changes, in case this widget stays mounted across an account switch
  // instead of remounting fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(chatHistoryKey);
      setMessages(raw ? JSON.parse(raw) : [
        {
          from: "ai",
          text: user ? `Hi! I'm ${user.business || "your business"}'s assistant. Ask me about hours, pricing, or booking.` : "Hi! Ask me about hours, pricing, or booking.",
        },
      ]);
      const storedDisappearing = window.localStorage.getItem(disappearingKey);
      setDisappearing(storedDisappearing !== null ? storedDisappearing === "true" : user?.disappearingDefault !== false);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageScope]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(disappearingKey, String(disappearing));
    }
  }, [disappearing, disappearingKey]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (disappearing) {
        window.localStorage.removeItem(chatHistoryKey);
      } else {
        window.localStorage.setItem(chatHistoryKey, JSON.stringify(messages));
      }
    }
  }, [messages, disappearing, chatHistoryKey]);

  const [knowledge, setKnowledge] = useState({ faqs: [], services: [] });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    Promise.all([
      supabase.from("faqs").select("question, answer").eq("business_id", user.id),
      supabase.from("services").select("id, name, price, duration").eq("business_id", user.id),
    ]).then(([faqsRes, servicesRes]) => {
      if (cancelled) return;
      setKnowledge({
        faqs: faqsRes.data || [],
        services: servicesRes.data || [],
      });
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const clearChat = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(chatHistoryKey);
    }
    setMessages([
      {
        from: "ai",
        text: user ? `Hi! I'm ${user.business || "your business"}'s assistant. Ask me about hours, pricing, or booking.` : "Hi! Ask me about hours, pricing, or booking.",
      },
    ]);
    setBookingNotice("");
    setConnectionIssue(false);
  };

  const send = async (text) => {
    if (!enabled) return;
    const nextText = `${text || draft || ""}`.trim();
    if (!nextText) return;

    const nextConversation = [...messages, { from: "customer", text: nextText }];
    setMessages(nextConversation);
    setDraft("");
    setConnectionIssue(false);

    const isBookingIntent = /(book|booking|room|suite|stay|reservation|date|dates|friday|saturday|sunday|tomorrow|weekend|guest|guests|time|slot)/i.test(nextText);
    if (isBookingIntent) {
      // All authoritative booking records must be created on the server.
      setBookingNotice("Booking requests require staff confirmation. No appointment has been reserved.");
    } else {
      setBookingNotice("");
    }

    try {
      const payload = buildAssistantRequestPayload(nextText, user, nextConversation, knowledge, { previewOnly });
      payload.requestId = crypto.randomUUID();
      setIsTyping(true);
      const response = await fetch(`${API_BASE_URL}/assistant-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Server responded ${response.status}`);
      }

      const data = await response.json();
      setIsTyping(false);
      setMessages((m) => [...m, { from: "ai", text: data.reply }]);
    } catch (err) {
      console.error("assistant-reply request failed:", err);
      setIsTyping(false);
      setConnectionIssue(true);
      const fallback = buildOfflineFallbackReply(nextText, user, nextConversation);
      setMessages((m) => [
        ...m,
        { from: "ai", text: fallback, offline: true },
      ]);
    }
  };

  const submitBookingRequest = async () => {
    if (bookingBusy || !user?.id || previewOnly) return;
    setBookingBusy(true);
    setBookingNotice("");
    try {
      if (!booking.startAt) throw new Error("Choose a date and time.");
      const timestamp = new Date(booking.startAt);
      if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid appointment time.");
      const response = await fetch(`${API_BASE_URL}/booking-requests`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          businessId:user.id,serviceId:booking.serviceId,
          customerName:booking.name,customerContact:booking.contact,
          startAt:timestamp.toISOString(),requestId:booking.requestId,
        }),
      });
      const result = await response.json().catch(()=>({}));
      if (!response.ok || result.status!=="pending") {
        throw new Error(result.error || "Could not save booking request.");
      }
      setBookingNotice("Your request has been saved for staff review. It is NOT a confirmed appointment.");
      setShowBookingForm(false);
      setBooking({name:"",contact:"",serviceId:"",startAt:"",requestId:crypto.randomUUID()});
    } catch(error) {
      setBookingNotice(error.message || "Booking request failed.");
    } finally {
      setBookingBusy(false);
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
    recognition.onresult = (event) => setDraft((current) => `${current}${current ? " " : ""}${event.results[0][0].transcript}`);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
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
      <p className="widget-demo-caption">This is the embeddable widget your customers see on your site.</p>
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
                <span className="widget-status-label mono">AI online</span>
              </span>
              <button
                className={`icon-btn ${disappearing ? "icon-btn--active" : ""}`}
                onClick={() => setDisappearing((d) => !d)}
                title={disappearing ? "Disappearing messages: on" : "Disappearing messages: off"}
              >
                <Clock className="icon-btn-icon" />
              </button>
              <button className="icon-btn" onClick={clearChat} title="Clear chat">
                <Trash2 className="icon-btn-icon" />
              </button>
              <button className="icon-btn" onClick={() => setOpen(false)}><X className="icon-btn-icon" /></button>
            </div>
          </div>
          <div className="widget-body">
            {connectionIssue && (
              <div className="widget-connection-warning">
                <AlertTriangle className="icon-btn-icon" />
                Couldn't reach the AI server - showing a basic offline reply below, not the real AI.
              </div>
            )}
            {disappearing && (
              <div className="widget-disappearing-note">
                Disappearing messages is on - this chat won't be saved.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.from === "customer" ? "chat-bubble--customer" : "chat-bubble--ai"} ${m.offline ? "chat-bubble--offline" : ""}`}>
                {m.text}
              </div>
            ))}
            {isTyping && (
              <div className="chat-bubble chat-bubble--ai chat-bubble--typing">
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
                <input className="field-input" placeholder="Your name" value={booking.name}
                  onChange={e=>setBooking(b=>({...b,name:e.target.value}))} />
                <input className="field-input" placeholder="Email or phone" value={booking.contact}
                  onChange={e=>setBooking(b=>({...b,contact:e.target.value}))} />
                <select className="field-input" value={booking.serviceId}
                  onChange={e=>setBooking(b=>({...b,serviceId:e.target.value}))}>
                  <option value="">Choose a service</option>
                  {knowledge.services.map(service=><option key={service.id} value={service.id}>
                    {service.name} ({service.duration || "duration not set"})
                  </option>)}
                </select>
                <input className="field-input" type="datetime-local" value={booking.startAt}
                  onChange={e=>setBooking(b=>({...b,startAt:e.target.value}))} />
                <button className="btn btn--amber" disabled={bookingBusy||!booking.serviceId}
                  onClick={submitBookingRequest}>{bookingBusy?"Submitting...":"Submit booking request"}</button>
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
              <button key={qr.label} className="quick-reply" onClick={() => send(qr.reply)} disabled={!enabled}>{qr.label}</button>
            ))}
          </div>
          {!enabled && <p className="panel-help widget-paused-note">The assistant is paused. Turn it live to resume customer replies.</p>}
          <div className="widget-input-row">
            <button className={`widget-voice ${isListening ? "widget-voice--active" : ""}`} onClick={toggleVoiceInput} disabled={!enabled || !voiceSupported} aria-label={isListening ? "Stop recording" : "Record voice message"} title={isListening ? "Stop recording" : "Record voice message"}>
              {isListening ? <MicOff className="icon-btn-icon" /> : <Mic className="icon-btn-icon" />}
            </button>
            <input
              className="field-input widget-input"
              placeholder="Type a message..."
              value={draft}
              disabled={!enabled}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="widget-send" onClick={() => send()} disabled={!enabled}><Send className="icon-btn-icon" /></button>
          </div>
        </div>
      )}
      {!open && (
        <button className="widget-bubble" onClick={() => setOpen(true)}>
          <MessageCircle className="icon-btn-icon" />
        </button>
      )}
    </div>
  );
}