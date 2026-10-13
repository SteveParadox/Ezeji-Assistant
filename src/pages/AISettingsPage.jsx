import React, { useState } from "react";
import { TextField } from "../shared";
import { hasActivePremiumPlan } from "../planAccess";
import { ChatWidgetDemo } from "../chatWidget";

export function AISettingsPage({ user, onUpdateUser }) {
  const plan = user?.plan || "14-day trial";
  const canCustomize = hasActivePremiumPlan(user);
  const [assistantName, setAssistantName] = useState(user?.assistantName || "Ezeji Assistant");
  const [tone, setTone] = useState(user?.tone || "Friendly & warm");
  const [greeting, setGreeting] = useState(user?.greeting || `Hi! I'm ${user?.business || "your business"}'s assistant - ask me about hours, pricing, or booking.`);
  const [escalationKeywords, setEscalationKeywords] = useState(user?.escalationKeywords || "refund, complaint, emergency");
  const [saveState, setSaveState] = useState("idle");
  const edit = (setter) => event => {
    setter(event.target.value);
    setSaveState("idle");
  };

  const save = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      if (!onUpdateUser) throw new Error("Assistant settings are unavailable");
      await onUpdateUser({ ...(user || {}), assistantName, tone, greeting, escalationKeywords });
      setSaveState("saved");
    } catch (error) {
      console.error("Assistant settings save failed:",error.message);
      setSaveState("error");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">AI Settings</h1><p className="page-sub">Set your assistant’s voice and review answers against saved business information.</p></div></div>
      <div className="settings-layout">
      {!canCustomize ? (
        <div className="panel">
          <h2 className="panel-title">Custom AI personality is a Professional feature</h2>
          <p className="panel-help">
            Your current plan ({plan}) uses the default assistant voice. Upgrade to Professional or Business in Billing to customize your assistant's name, tone, greeting, and escalation keywords.
          </p>
        </div>
      ) : (
        <div className="panel form-panel">
          <TextField label="Assistant name" value={assistantName} onChange={edit(setAssistantName)} />
          <label className="field">
            <span className="field-label">Tone of voice</span>
            <select className="field-input field-select" value={tone} onChange={edit(setTone)}>
              {["Friendly & warm", "Professional", "Playful", "Concise"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Greeting message</span>
            <textarea className="field-input field-textarea" rows={2} value={greeting} onChange={edit(setGreeting)} />
          </label>
          <TextField label="Escalation keywords (comma separated)" value={escalationKeywords} onChange={edit(setEscalationKeywords)} />
          {saveState === "saved" && <p className="save-status" role="status">Saved successfully</p>}
          {saveState === "error" && <p className="auth-error" role="alert">Could not save assistant settings. Retry.</p>}
          <button className="btn btn--amber" disabled={saveState === "saving" || !canCustomize} onClick={save}>{saveState === "saving" ? "Saving..." : "Save settings"}</button>
        </div>
      )}
      <section className="panel preview-panel"><p className="panel-eyebrow">Try it privately</p><h2 className="panel-title">Assistant preview</h2>
        <p className="panel-help">Uses your saved settings. Preview messages do not create bookings or customer conversations; successful requests consume AI usage.</p>
        <ChatWidgetDemo user={user} previewOnly />
      </section>
      </div>
    </div>
  );
}

