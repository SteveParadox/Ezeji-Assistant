import test from "node:test";
import assert from "node:assert/strict";
import { isPublicHttpsWebhookUrl } from "./whatsappWebhookUrl.js";

test("public HTTPS webhook URLs are allowed for display", () => {
  assert.equal(isPublicHttpsWebhookUrl("https://api.ezeji.example/webhook/whatsapp"), true);
});
test("unusable, local and insecure webhook URLs cannot be presented as deployable", () => {
  for (const value of [
    "", "http://localhost:5174/webhook/whatsapp", "https://localhost/webhook",
    "https://dev.localhost/webhook", "https://127.0.0.1/webhook",
    "https://10.1.2.3/webhook", "https://172.20.0.2/webhook",
    "https://192.168.1.9/webhook", "javascript:alert(1)",
    "https://user:pass@api.example.org/webhook",
    "https://api.example.org/webhook#wrong",
  ]) assert.equal(isPublicHttpsWebhookUrl(value), false, value);
});
