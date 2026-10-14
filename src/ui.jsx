import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { containDialogFocus } from "./dialogFocus";
import { AlertCircle, Inbox, X } from "lucide-react";

export function EmptyState({ title, children, icon: Icon = Inbox }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon size={22} aria-hidden="true" /></span>
    <h2>{title}</h2><p>{children}</p></div>;
}
export function Skeleton({ lines = 3 }) {
  return <div className="skeleton-stack" role="status" aria-label="Loading saved data">
    {Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton" aria-hidden="true" />)}
    <span className="sr-only">Loading saved data</span></div>;
}
export function TableFrame({ children, label }) {
  return <div className="table-frame" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
export function StatusBadge({ status }) {
  const tone = ["confirmed", "paid", "active", "saved"].includes(status) ? "green"
    : ["failed", "error", "expired"].includes(status) ? "red"
    : ["pending", "escalated", "attention"].includes(status) ? "amber" : "neutral";
  return <span className={`badge badge--${tone}`}>{status?.replaceAll("_", " ") || "Unknown"}</span>;
}
export function FormSection({ title, description, children }) {
  return <section className="form-section"><div className="form-section-heading"><h2>{title}</h2>
    {description && <p>{description}</p>}</div><div className="form-section-fields">{children}</div></section>;
}

// Native modal dialogs provide browser focus containment, background inertness,
// Escape behavior and focus restoration. Resolve every request on dismissal.
const ConfirmationContext = createContext(null);
export function ConfirmationProvider({ children }) {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);
  const confirm = useCallback((options) => new Promise(resolve => {
    pending.current?.resolve(false);
    pending.current = { resolve, owner: options.owner };
    setRequest(options);
  }), []);
  const finish = useCallback((accepted) => {
    pending.current?.resolve(accepted);
    pending.current = null;
    setRequest(null);
  }, []);
  const cancel = useCallback(owner => {
    if (pending.current?.owner === owner) finish(false);
  }, [finish]);
  const context = useMemo(() => ({ ask: confirm, cancel }), [confirm, cancel]);
  useEffect(() => () => pending.current?.resolve(false), []);
  return <ConfirmationContext.Provider value={context}>{children}
    <ConfirmDialog request={request} onClose={finish} />
  </ConfirmationContext.Provider>;
}
export function useConfirmation() {
  const context = useContext(ConfirmationContext);
  const owner = useRef({});
  useEffect(() => {
    const scope = owner.current;
    return () => context?.cancel(scope);
  }, [context]);
  const confirm = useCallback(options => context.ask({ ...options, owner: owner.current }), [context]);
  if (!context) throw new Error("ConfirmationProvider is required.");
  return confirm;
}
export function ConfirmDialog({ request, onClose }) {
  const dialog = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (request && !node.open) node.showModal();
    if (!request && node.open) node.close();
  }, [request]);
  return <dialog className="confirm-dialog" ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} aria-modal="true" onKeyDown={containDialogFocus}
    onCancel={(event) => { event.preventDefault(); onClose(false); }}>
    <div className="dialog-header"><span className="empty-state-icon"><AlertCircle size={22} /></span>
      <button type="button" className="icon-btn" aria-label="Close confirmation" onClick={() => onClose(false)}><X size={18} /></button></div>
    <h2 id={titleId}>{request?.title}</h2><p id={descriptionId}>{request?.description}</p>
    <div className="dialog-actions"><button type="button" className="btn btn--outline" autoFocus onClick={() => onClose(false)}>Keep it</button>
      <button type="button" className={`btn ${request?.tone === "primary" ? "btn--amber" : "btn--danger"}`} onClick={() => onClose(true)}>{request?.action || "Confirm"}</button></div>
  </dialog>;
}
