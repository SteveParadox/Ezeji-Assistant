import React, { useEffect, useState } from "react";
import { TextField } from "../shared";
import { useConfirmation, Skeleton, StatusBadge } from "../ui";
import { hasActivePremiumPlan } from "../planAccess";
import { workspaceApi } from "../workspaceApi";

export function IntegrationsPage({ user }) {
  const confirm = useConfirmation();
  const plan = user?.plan || "14-day trial";
  const canConnect = hasActivePremiumPlan(user); // Server independently enforces this entitlement
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [testState, setTestState] = useState("idle");
  const [connectionError, setConnectionError] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled=false;
    workspaceApi("/integrations/whatsapp")
      .then(({connection})=>{
        if(cancelled)return;
        if(connection){setConnected(true);setPhoneNumberId(connection.phone_number_id||"");}
      })
      .catch(error=>{if(!cancelled)setConnectionError(error.message||"Connection status unavailable");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[user?.id]);

  const save=async()=>{
    if(!phoneNumberId.trim()||!accessToken.trim()){setConnectionError("Enter a phone number ID and a new access token.");return;}
    setConnectionError("");setTestState("testing");
    try {
      const {connection}=await workspaceApi("/integrations/whatsapp",{
        method:"PUT",body:JSON.stringify({phoneNumberId:phoneNumberId.trim(),accessToken:accessToken.trim()})
      });
      setConnected(true);setBusinessNumber(connection?.displayPhoneNumber||"");
      setAccessToken("");setSaveState("saved");
    }catch(error){setConnectionError(error.message||"Could not connect WhatsApp");}
    finally{setTestState("idle");}
  };
  const disconnect=async()=>{
    if (!await confirm({ title: "Disconnect WhatsApp?", description: "This business will stop receiving assistant replies through the saved WhatsApp connection.", action: "Disconnect" })) return;
    setConnectionError("");
    try{
      await workspaceApi("/integrations/whatsapp",{method:"DELETE"});
      setConnected(false);setPhoneNumberId("");setAccessToken("");setBusinessNumber("");
    }catch(error){setConnectionError(error.message||"Could not disconnect WhatsApp");}
  };

  const webhookUrl = typeof window !== "undefined"
    ? (import.meta.env.VITE_WHATSAPP_WEBHOOK_URL || "http://localhost:5174/webhook/whatsapp")
    : "";

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Integrations</h1><p className="page-sub">Connect WhatsApp so customers can message your real number, not just the web widget.</p></div></div>

      <section className="panel"><div className="panel-heading"><h2 className="panel-title">Customer web chat</h2><StatusBadge status="link available" /></div>
        <p className="panel-help">Open your business chat to test saved answers and booking requests before sharing it with customers.</p>
        <a className="btn btn--outline" href={`?view=chat&biz=${encodeURIComponent(user.id)}`} target="_blank" rel="noopener noreferrer">Open customer chat</a>
      </section>
      {!canConnect ? (
        <div className="panel">
          <h2 className="panel-title">WhatsApp · unavailable on your current plan</h2>
          <p className="panel-help">
            Your current plan ({plan}) doesn't include WhatsApp. Upgrade to Professional or Business in Billing to connect a real WhatsApp number.
          </p>
        </div>
      ) : (
        <>
      <div className="panel">
        <div className="panel-heading"><h2 className="panel-title">WhatsApp</h2><StatusBadge status={loading ? "checking configuration" : connectionError ? "attention" : connected ? "configuration saved" : "not connected"} /></div>
        <p className="panel-help">A saved configuration is not a live connection-health check. New credentials are verified with Meta when you save.</p>
        {connected && businessNumber && <p className="panel-help">Verified number: {businessNumber}</p>}
        <p className="panel-help">
          From your Meta Developer app's WhatsApp -&gt; API Setup page, copy your Phone Number ID and access token below.
        </p>
        {loading ? (
          <Skeleton />
        ) : (
          <div className="form-panel">
            <TextField label="Phone Number ID" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="e.g. 109876543210987" />
            <TextField label="Access token" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Paste your Meta access token" />
            {connectionError && <p className="auth-error" role="alert">{connectionError}</p>}
            {saveState === "saved" && <p className="save-status" role="status">Saved successfully</p>}
            <div className="billing-actions">
              <button className="btn btn--amber" onClick={save} disabled={testState === "testing"}>{testState === "testing" ? "Verifying with Meta..." : connected ? "Update connection" : "Connect WhatsApp"}</button>
              {connected && <button className="btn btn--outline" onClick={disconnect}>Disconnect</button>}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Webhook setup (one-time, in Meta's dashboard)</h2>
        <p className="panel-help">
          In your Meta app's WhatsApp -&gt; Configuration page, set the Callback URL and Verify Token to these values, so Meta knows where to send incoming messages:
        </p>
        <div className="form-panel">
          <TextField label="Callback URL" value={webhookUrl} onChange={() => {}} />
          <p className="panel-help" style={{ marginTop: -8 }}>Meta must be able to reach this URL over HTTPS. Set VITE_WHATSAPP_WEBHOOK_URL to your deployed public webhook URL before connecting a production number.</p>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

