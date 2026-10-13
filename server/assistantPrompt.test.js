import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantSystemPrompt } from "./assistantPrompt.js";

const saved = {
  business: "River Salon", plan: "Professional", assistant_name: "Nia", tone: "Concise",
  greeting: "Welcome to our salon", escalation_keywords: "refund", hours: "Mon-Fri 9am-5pm",
  hours_json: [{day: "Monday", open: "09:00", close: "17:00", closed: false}],
};

test("preview and customer replies can consume the same server-side prompt", () => {
  const prompt = buildAssistantSystemPrompt(saved,
    [{name: "Haircut", price: "NGN 15000"}], [{ question: "Where?", answer: "Lagos" }]);
  assert.match(prompt, /Nia for River Salon/);
  assert.match(prompt, /Concise/);
  assert.match(prompt, /NGN 15000/);
  assert.match(prompt, /refund/);
  assert.match(prompt, /staff/);
  assert.match(prompt, /09:00/);
});

test("Starter and trial cannot bypass premium personality gating", () => {
  for (const plan of ["Starter", "14-day trial"]) {
    const prompt = buildAssistantSystemPrompt({ ...saved, plan });
    assert.doesNotMatch(prompt, /Nia|Concise|Welcome to our salon|refund/);
    assert.match(prompt, /the customer assistant/);
  }
});

test("a profile lacking business facts does not receive fictitious hours or prices", () => {
  const prompt = buildAssistantSystemPrompt({ business: "New Shop", plan: "14-day trial" });
  assert.match(prompt, /Not provided/);
  assert.doesNotMatch(prompt, /9am|NGN [0-9]/);
});
