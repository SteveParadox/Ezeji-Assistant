import test from "node:test";
import assert from "node:assert/strict";
import { buildOfflineFallbackReply } from "./assistantLogic.js";

test("offline replies never fabricate prices when no actual price is saved", () => {
  const reply = buildOfflineFallbackReply("How much for hair styling?", {
    business: "Example Salon", businessType: "Salon & Beauty", serviceName: "Hair styling",
  });
  assert.match(reply, /don't have verified pricing|contact the business/i);
  assert.doesNotMatch(reply, /\$\d|default|starts at/i);
});

test("offline replies never fabricate opening hours", () => {
  const reply = buildOfflineFallbackReply("What are your hours?", {
    business: "Example Restaurant", businessType: "Restaurant",
  });
  assert.match(reply, /don't have verified business hours|confirm/i);
  assert.doesNotMatch(reply, /Mon-|10:00|default/i);
});

test("offline replies still include actually saved business prices", () => {
  const reply = buildOfflineFallbackReply("What does a haircut cost?", {
    business: "Example Salon", businessType: "Salon & Beauty", serviceName: "Haircut", price: "NGN 12000",
  });
  assert.match(reply, /NGN 12000/);
});
