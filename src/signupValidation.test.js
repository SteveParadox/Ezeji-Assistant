import test from "node:test";
import assert from "node:assert/strict";
import { validateSignupFields } from "./signupValidation.js";

const valid = { name: "Ada Lovelace", business: "Ada's Studio", email: "ada@example.com", password: "eightchars" };
test("minimal registration requires only identity and credentials", () => {
  assert.equal(validateSignupFields(valid), null);
  assert.equal(validateSignupFields({ ...valid, serviceName: "", description: "", hours: "" }), null);
});
test("registration rejects missing name, business, invalid email and short password", () => {
  assert.match(validateSignupFields({ ...valid, name: " " }), /full name/);
  assert.match(validateSignupFields({ ...valid, business: "" }), /business name/);
  assert.match(validateSignupFields({ ...valid, email: "not-an-email" }), /valid email/);
  assert.match(validateSignupFields({ ...valid, password: "1234567" }), /8 characters/);
});
