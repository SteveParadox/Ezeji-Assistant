// Requests carry identity and current input only. Server knowledge and history are authoritative.
export function buildAssistantRequestPayload(message, profile = {}, _conversation = [], _knowledge = {}, options = {}) {
  return {message:String(message||'').trim(),businessId:profile.id||null,preview:options.previewOnly===true};
}
export function buildOfflineFallbackReply(_message,profile={}) {
  const contact=profile.phone||profile.contactPhone||profile.contactEmail;
  return `The assistant is temporarily unavailable. No AI answer or booking confirmation was received.${contact?` You can contact the business at ${contact}.`:' Please retry or contact the business directly.'}`;
}
export const buildAssistantReply=buildOfflineFallbackReply;
