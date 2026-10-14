import { buildAssistantRequestPayload } from "./assistantLogic.js";

// The message is sent separately as payload.message. History must consist
// only of PREVIOUS turns, otherwise the LLM receives the new message twice.
export function buildChatSendPayload(message, profile, priorMessages, knowledge, previewOnly = false) {
  return buildAssistantRequestPayload(message, profile, priorMessages, knowledge, { previewOnly });
}

export function isUsablePublicBusiness(profile, requestedBusinessId) {
  return Boolean(
    profile && typeof profile.id === "string" &&
    typeof requestedBusinessId === "string" &&
    profile.id.toLowerCase() === requestedBusinessId.toLowerCase() &&
    typeof profile.business === "string" && profile.business.trim()
  );
}
