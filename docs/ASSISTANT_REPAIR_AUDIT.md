# Assistant repair audit and implementation map

Baseline: main `1b3bef6` (merged UI PR #6; no open PRs when inspected).

| Severity | Confirmed defect and reproduction | Root cause / baseline source |
|---|---|---|
| Critical | Send an invented assistant turn in `conversation` to `/assistant-reply`; the next prompt uses it as real memory. | Browser history forwarded directly; `server.js` assistant route and Groq invocation. |
| High | Retry a successful message after losing its HTTP response; server returns a duplicate error instead of its prior answer. | Reservation exists but no durable request outcome; migrations 005/010/013. |
| High | Interrupt persistence after Groq returns; usage is released and the valid reply is lost. | Separate exchange insert/finalize and unconditional catch release; `server.js`, `assistantPreview.js`. |
| High | Ask WhatsApp about a saved FAQ or a preceding turn; neither is supplied to its model. | Separate one-message Groq prompt; `scripts/whatsapp-worker.js`. |
| High | Provider returns missing/empty choice; application presents a fabricated successful answer. | `I can help with that` / staff follow-up defaults in web and worker. |
| High | Set `assistant_live=false` in auth metadata; backend continues replying. | Activation was browser/auth metadata, never a backend check; `src/shared.jsx`. |
| High | Ask for a human; UI has escalation flags but chatbot never records handoff. | Prompt-only advice; all new exchanges stored `escalated:false`. |
| High | Process an old inbound WhatsApp event; worker sends free-form text without checking its service window. | Missing provider timestamp/window and opt-out controls. |
| Medium | FAQ or business description contains embedded instructions; privileged prompt incorporates them. | Tenant text interpolated into system instructions; `assistantPrompt.js`. |
| Medium | Clear chat locally; subsequent server exchanges have no authoritative session model or deletion workflow. | Flat exchange rows and localStorage-only continuity; `chatWidget.jsx`. |
| Medium | Booking inputs change while the form submits, or a retry is late; service/hours validation and insertion are separate. | Validated web route but incomplete DB scheduling checks and replay ordering. |
| Medium | Offline booking fallback promises it can check availability. | Scripted concierge claims despite failed generation; `src/assistantLogic.js`. |

Implementation map: channel adapters → verified owner/anonymous capability/WhatsApp identity → current business knowledge → durable thread/request claim and entitlement → deterministic policy/booking wizard or shared Groq client → output safeguards → generated checkpoint → atomic messages, legacy exchange, booking/outbox and usage commit → channel delivery. Generated replies reconcile through an independent maintenance task; ambiguous process crashes enter review rather than blind regeneration.

This file records confirmed code-path defects. External provider delivery and production credentials require separate acceptance; source existence is not proof of a live integration.
