import test from "node:test";
import assert from "node:assert/strict";
import { buildChatSendPayload, isUsablePublicBusiness } from "./chatRequest.js";

test("new customer message is not copied into prior conversation history", () => {
  const previous = [{ from: "ai", text: "Hello" }, { from: "customer", text: "Price?" }];
  const result = buildChatSendPayload("What time tomorrow?", { id: "b1", business: "Salon" }, previous, {}, false);
  assert.equal(result.message, "What time tomorrow?");
  assert.deepEqual(result.conversation, previous);
  assert.equal(result.conversation.filter((msg) => msg.text === result.message).length, 0);
});

test("preview preserves business id and separates preview request flag", () => {
  const result = buildChatSendPayload("Hello", { id: "b1" }, [], {}, true);
  assert.equal(result.businessId, "b1");
  assert.equal(result.preview, true);
});

test("invalid customer links never fall back to a signed-in owner's business", () => {
  assert.equal(isUsablePublicBusiness(null, "b1"), false);
  assert.equal(isUsablePublicBusiness({ id: "b2", business: "Private salon" }, "b1"), false);
  assert.equal(isUsablePublicBusiness({ id: "b1", business: "Public salon" }, "b1"), true);
});
