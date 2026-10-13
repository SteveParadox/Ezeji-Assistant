import React, { useState } from "react";
import { TextField } from "../shared";
import { normalizeWorkingHours, validateWorkingHours, summarizeWorkingHours } from "../workingHours";

const DEFAULT_HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => ({
  day, open: "", close: "", closed: true,
}));

export function HoursLocationPage({ user, onUpdateUser }) {
  const [hours, setHours] = useState(() => normalizeWorkingHours(user?.hoursJson || DEFAULT_HOURS));
  const [address, setAddress] = useState(user?.address || "");
  const [cityStateZip, setCityStateZip] = useState(user?.cityStateZip || "");
  const [timezone, setTimezone] = useState(user?.timezone || "Africa/Lagos");
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  const markEdited = () => {
    setSaveState("idle");
    setSaveError("");
  };
  const toggle = (i) => {
    setHours((rows) => rows.map((row, idx) => idx === i ? { ...row, closed: !row.closed } : row));
    markEdited();
  };
  const setClock = (i, key, value) => {
    setHours((rows) => rows.map((row, idx) => idx === i ? { ...row, [key]: value } : row));
    markEdited();
  };
  const editField = (setter) => event => {
    setter(event.target.value);
    markEdited();
  };

  const save = async () => {
    if (saveState === "saving") return;
    setSaveError("");
    if (!address.trim() || !cityStateZip.trim()) {
      setSaveState("error");
      setSaveError("Enter your address and city or region.");
      return;
    }
    const scheduleError = validateWorkingHours(hours);
    if (scheduleError) {
      setSaveState("error");
      setSaveError(scheduleError);
      return;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      setSaveState("error");
      setSaveError("Choose a valid IANA timezone, for example Africa/Lagos.");
      return;
    }
    setSaveState("saving");
    try {
      if (!onUpdateUser) throw new Error("Business settings unavailable.");
      await onUpdateUser({ ...(user || {}), hoursJson: hours, hours: summarizeWorkingHours(hours, timezone),
        address: address.trim(), cityStateZip: cityStateZip.trim(), timezone });
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setSaveError("Could not save your hours and location. Your changes are still here.");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Hours & Location</h1>
          <p className="page-sub">Choose your actual open days and enter their opening and closing times. All days start closed until configured.</p>
        </div>
      </div>
      <div className="settings-layout">
      <div className="panel">
        <h2 className="panel-title">Weekly schedule</h2>
        {hours.map((row, i) => (
          <div key={row.day} className="hours-row">
            <span className="hours-day">{row.day}</span>
            <label className="hours-edit-field">Opens
              <input type="time" className="field-input" aria-label={`${row.day} opening time`}
                value={row.open} disabled={row.closed} onChange={(event) => setClock(i, "open", event.target.value)} />
            </label>
            <label className="hours-edit-field">Closes
              <input type="time" className="field-input" aria-label={`${row.day} closing time`}
                value={row.close} disabled={row.closed} onChange={(event) => setClock(i, "close", event.target.value)} />
            </label>
            <button type="button" className="link-btn" aria-label={`${row.day}: ${row.closed ? "mark open" : "mark closed"}`} aria-pressed={!row.closed} onClick={() => toggle(i)}>{row.closed ? "Mark open" : "Mark closed"}</button>
          </div>
        ))}
      </div>
      <div className="panel form-panel">
        <h2 className="panel-title">Location & timezone</h2>
        <p className="panel-help">Save your weekly schedule and location together. Closed days have no invented opening times.</p>
        <TextField label="Street address" value={address} onChange={editField(setAddress)} />
        <TextField label="City / State / ZIP" value={cityStateZip} onChange={editField(setCityStateZip)} />
        <label className="field">
          <span className="field-label">Timezone (IANA identifier)</span>
          <input className="field-input" value={timezone} onChange={editField(setTimezone)}
            placeholder="Africa/Lagos" aria-label="Business timezone" />
        </label>
        {saveState === "saved" && <p className="save-status" role="status">Saved successfully</p>}
        {saveState === "error" && <p className="auth-error" role="alert">{saveError}</p>}
        <button type="button" className="btn btn--amber" onClick={save} disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving..." : "Save hours and location"}
        </button>
      </div>
      </div>
    </div>
  );
}

