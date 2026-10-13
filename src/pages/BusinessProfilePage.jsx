import React, { useRef, useState } from "react";
import { TextField } from "../shared";
import { FormSection } from "../ui";
import { buildBusinessProfileUpdate } from "../businessProfileFields";

export function BusinessProfilePage({ user, onUpdateUser, onNavigate }) {
  const [form, setForm] = useState({
    name: user?.business || "",
    category: user?.businessType || "Other",
    customBusinessType: user?.customBusinessType || "",
    description: user?.description || "",
    phone: user?.phone || "",
    email: user?.contactEmail || "",
    website: user?.website || "",
    serviceName: user?.serviceName || "",
    price: user?.price || "",
  });
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const editRevision = useRef(0);
  const savingRef = useRef(false);
  const set = (k) => (e) => {
    editRevision.current += 1;
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setSaveState((state) => state === "saving" ? "saving" : "idle");
    setSaveError("");
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    let nextUser;
    try {
      nextUser = buildBusinessProfileUpdate(form, user);
    } catch (validationError) {
      setSaveError(validationError.message || "Check your business details.");
      setSaveState("error");
      return;
    }
    savingRef.current = true;
    const revisionAtStart = editRevision.current;
    setSaveState("saving");
    setSaveError("");
    try {
      if (!onUpdateUser) throw new Error("Profile saving is unavailable");
      await onUpdateUser(nextUser);
      setSaveState(editRevision.current === revisionAtStart ? "saved" : "idle");
    } catch (error) {
      console.error("Business profile save failed:", error.message);
      if (editRevision.current === revisionAtStart) {
        setSaveError("Could not save your business profile. Check your connection and retry.");
        setSaveState("error");
      } else {
        setSaveState("idle");
      }
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Business Profile</h1><p className="page-sub">This is what your AI assistant knows about you.</p></div></div>
      <div className="panel form-panel">
        <FormSection title="Business identity" description="These saved details help your assistant describe your business accurately.">
        <TextField label="Business name" value={form.name} onChange={set("name")} />
        <label className="field">
          <span className="field-label">Category</span>
          <select className="field-input field-select" value={form.category} onChange={set("category")}>
            {["Salon & Beauty", "Restaurant", "Hotel", "Clinic", "Laundry", "Real Estate", "Gym", "Other"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {form.category === "Other" && (
          <TextField label="Custom business type" value={form.customBusinessType} onChange={set("customBusinessType")} />
        )}
        <label className="field">
          <span className="field-label">Description</span>
          <textarea className="field-input field-textarea" rows={3} value={form.description} onChange={set("description")} />
        </label>
        </FormSection>
        <FormSection title="Customer contact" description="Public contact information is separate from your sign-in details.">
        <TextField label="Phone" value={form.phone} onChange={set("phone")} />
        <TextField label="Public contact email (not login email)" type="email" value={form.email} onChange={set("email")} />
        <TextField label="Website" value={form.website} onChange={set("website")} />
        </FormSection>
        <FormSection title="Assistant context" description="Keep your summary up to date. Manage your full service catalog and weekly schedule from their dedicated pages.">
        <TextField label="Service name" value={form.serviceName} onChange={set("serviceName")} />
        <TextField label="Price" value={form.price} onChange={set("price")} />
        <div className="field">
          <span className="field-label">Saved operating hours</span>
          <p className="panel-help">{user?.hours || "No hours have been saved yet."}</p>
          <button type="button" className="link-btn" onClick={() => onNavigate?.("hours")}>
            Edit weekly schedule, timezone, and location
          </button>
        </div>
        </FormSection>
        {saveState === "saved" && <p className="save-status" role="status">Saved successfully</p>}
        {saveState === "error" && <p className="auth-error" role="alert">{saveError}</p>}
        <button className="btn btn--amber" disabled={saveState === "saving"} onClick={handleSave}>{saveState === "saving" ? "Saving..." : "Save changes"}</button>
      </div>
    </div>
  );
}

