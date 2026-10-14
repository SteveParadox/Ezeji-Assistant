import React, { useEffect, useRef, useState } from "react";
import { workspaceApi } from "../workspaceApi";
import { TextField } from "../shared";
import { hasActivePremiumPlan } from "../planAccess";
import { ChatWidgetDemo } from "../chatWidget";

export function AISettingsPage({ user, onUpdateUser }) {
  const [availability,setAvailability]=useState(null),[availabilityError,setAvailabilityError]=useState(""),[settingsBusy,setSettingsBusy]=useState(false);
  const [policies,setPolicies]=useState({booking:"",cancellation:"",refund:"",languages:""});
  const settingsGuard=useRef(false);
  useEffect(()=>{let current=true;workspaceApi(`/assistant-settings/${user.id}`).then(data=>{if(current){setAvailability(data);setPolicies({...data.policies,languages:data.languages||""});}}).catch(()=>{if(current)setAvailabilityError("Assistant availability could not be loaded. Retry by returning to this page.");});return()=>{current=false};},[user.id]);
  const saveAvailability=async(active)=>{
    if(settingsGuard.current)return;settingsGuard.current=true;setSettingsBusy(true);setAvailabilityError("");
    try{const data=await workspaceApi(`/assistant-settings/${user.id}`,{method:"PATCH",body:JSON.stringify(typeof active==="boolean"?{active}:{...policies})});setAvailability(v=>({...v,active:data.active}));}
    catch(e){setAvailabilityError(e.message);}finally{settingsGuard.current=false;setSettingsBusy(false);}
  };
  const plan = user?.plan || "14-day trial";
  const canCustomize = hasActivePremiumPlan(user);
  const [assistantName, setAssistantName] = useState(user?.assistantName || "Ezeji Assistant");
  const [tone, setTone] = useState(user?.tone || "Friendly & warm");
  const [greeting, setGreeting] = useState(user?.greeting || `Hi! I'm ${user?.business || "your business"}'s assistant - ask me about hours, pricing, or booking.`);
  const [escalationKeywords, setEscalationKeywords] = useState(user?.escalationKeywords || "refund, complaint, emergency");
  const [saveState, setSaveState] = useState("idle");
  const editRevision = useRef(0);
  const savingRef = useRef(false);
  const edit = (setter) => event => {
    editRevision.current += 1;
    setter(event.target.value);
    setSaveState(state => state === "saving" ? "saving" : "idle");
  };

  const save = async () => {
    if (savingRef.current || !canCustomize) return;
    savingRef.current = true;
    const revisionAtStart = editRevision.current;
    setSaveState("saving");
    try {
      if (!onUpdateUser) throw new Error("Assistant settings are unavailable");
      await onUpdateUser({ id:user.id, assistantName, tone, greeting, escalationKeywords });
      setSaveState(editRevision.current === revisionAtStart ? "saved" : "idle");
    } catch (error) {
      console.error("Assistant settings save failed:", error.message);
      setSaveState(editRevision.current === revisionAtStart ? "error" : "idle");
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">AI Settings</h1><p className="page-sub">Set your assistant’s voice and review answers against saved business information.</p></div></div>
      <div className="settings-layout"><div className="assistant-configuration">
      <section className="panel form-panel" aria-label="Assistant availability and policies">
        <h2 className="panel-title">Activation and business policies</h2>
        <p className="panel-help">Customer chat and WhatsApp use saved settings. Preview remains private and consumes the same AI allowance. Subscription and quota checks apply on the server.</p>
        {availability && <><p role="status">Customer assistant: {availability.active?"Active":"Paused"}</p><p className="panel-help">{availability.readiness.ready?"Essential business information is saved.":`Setup needs: ${availability.readiness.missing.join(", ")}.`} Booking requests require a premium plan, valid service duration and saved hours; staff must confirm.</p>
          <button className="btn btn--outline" disabled={settingsBusy||(!availability.active&&!availability.readiness.ready)} onClick={()=>saveAvailability(!availability.active)}>{availability.active?"Pause customer assistant":"Activate customer assistant"}</button></>}
        {availabilityError && <p className="auth-error" role="alert">{availabilityError}</p>}
        <details className="assistant-policies"><summary>Business policies and language preferences</summary>
        <div className="assistant-policy-grid">{["booking","cancellation","refund"].map(key=><label className="field" key={key}><span className="field-label">{key.charAt(0).toUpperCase()+key.slice(1)} policy</span><textarea className="field-input" rows={2} disabled={!availability||settingsBusy} maxLength={1500} value={policies[key]} onChange={e=>setPolicies(v=>({...v,[key]:e.target.value}))}/></label>)}</div>
        <TextField label="Language preferences" disabled={!availability||settingsBusy} maxLength={160} value={policies.languages} onChange={e=>setPolicies(v=>({...v,languages:e.target.value}))} />
        <button className="btn btn--amber" disabled={settingsBusy||!availability} onClick={()=>saveAvailability()}>{settingsBusy?"Saving...":"Save policies"}</button>
        </details>
      </section>
      {!canCustomize ? (
        <div className="panel">
          <h2 className="panel-title">Custom AI personality is a Professional feature</h2>
          <p className="panel-help">
            Your current plan ({plan}) uses the default assistant voice. Upgrade to Professional or Business in Billing to customize your assistant's name, tone, greeting, and escalation keywords.
          </p>
        </div>
      ) : (
        <div className="panel form-panel">
          <TextField label="Assistant name" maxLength={80} value={assistantName} onChange={edit(setAssistantName)} />
          <label className="field">
            <span className="field-label">Tone of voice</span>
            <select className="field-input field-select" value={tone} onChange={edit(setTone)}>
              {["Friendly & warm", "Professional", "Playful", "Concise"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Greeting message</span>
            <textarea className="field-input field-textarea" rows={2} maxLength={500} value={greeting} onChange={edit(setGreeting)} />
          </label>
          <TextField label="Escalation keywords (comma separated)" maxLength={500} value={escalationKeywords} onChange={edit(setEscalationKeywords)} />
          {saveState === "saved" && <p className="save-status" role="status">Saved successfully</p>}
          {saveState === "error" && <p className="auth-error" role="alert">Could not save assistant settings. Retry.</p>}
          <button className="btn btn--amber" disabled={saveState === "saving" || !canCustomize} onClick={save}>{saveState === "saving" ? "Saving..." : "Save settings"}</button>
        </div>
      )}
      </div>
      <section className="panel preview-panel"><p className="panel-eyebrow">Try it privately</p><h2 className="panel-title">Assistant preview</h2>
        <p className="panel-help">Uses your saved settings. Preview messages do not create bookings or customer conversations; successful requests consume AI usage.</p>
        <ChatWidgetDemo user={user} previewOnly />
      </section>
      </div>
    </div>
  );
}

