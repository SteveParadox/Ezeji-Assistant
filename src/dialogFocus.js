// Keep Tab within a modal's visible controls, including the browser-chrome boundary.
// Native showModal still supplies background inertness and Escape/focus restoration.
export function containDialogFocus(event) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const controls = Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'))
    .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
  if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
  const first = controls[0]; const last = controls.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if ((event.shiftKey && active === first) || (!event.shiftKey && active === last) || !dialog.contains(active)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  }
}
