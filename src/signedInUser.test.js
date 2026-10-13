import test from "node:test";
import assert from "node:assert/strict";
import { resolveSignedInUserWith } from "./signedInUser.js";

const user = { id: "owner-uuid", email: "owner@example.test" };
function staffResponse(status = 404, body = {}) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}
function fixtures({ profile = null, response = staffResponse(), failProfile, failStaff } = {}) {
  const state = { profiles: 0, staff: 0, token: null, metadata: null };
  const deps = {
    async lookupProfile(id, email, metadata) {
      state.profiles++;
      assert.equal(id, user.id);
      assert.equal(email, user.email);
      state.metadata = metadata;
      if (failProfile) throw failProfile;
      return profile;
    },
    async lookupStaff(token) {
      state.staff++;
      state.token = token;
      if (failStaff) throw failStaff;
      return response;
    },
  };
  return { deps, state };
}
test("missing profile with signup metadata bypasses staff lookup and returns for provisioning", async () => {
  const { deps, state } = fixtures({ failStaff: new Error("not reachable") });
  assert.equal(await resolveSignedInUserWith({ ...user, user_metadata: { business_registration: { business: "Cafe" } } }, "valid", deps), null);
  assert.equal(state.profiles, 1);
  assert.equal(state.staff, 0);
});
for (const metadata of [undefined, null, {}]) {
  test("missing profile with empty/missing metadata safely returns to onboarding", async () => {
    const { deps, state } = fixtures();
    assert.equal(await resolveSignedInUserWith({ ...user, user_metadata: metadata }, "valid", deps), null);
    assert.deepEqual(state.metadata, {});
    assert.equal(state.staff, 1);
  });
}
test("existing owner profile is reused", async () => {
  const profile = { id: user.id, business: "Existing" };
  const { deps, state } = fixtures({ profile });
  assert.equal(await resolveSignedInUserWith(user, "valid", deps), profile);
  assert.equal(state.staff, 0);
});
test("authorized staff remains scoped to employer business", async () => {
  const { deps, state } = fixtures({ response: staffResponse(200, { businessId: "11111111-1111-4111-8111-111111111111", plan: "Business" }) });
  const profile = await resolveSignedInUserWith(user, "verified-access-token", deps);
  assert.equal(profile.isStaff, true);
  assert.equal(profile.authUserId, user.id);
  assert.equal(profile.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(state.token, "verified-access-token");
});
test("unexpected staff response cannot impersonate a business", async () => {
  const { deps } = fixtures({ response: staffResponse(200, { businessId: "fake", plan: "Business" }) });
  await assert.rejects(resolveSignedInUserWith(user, "valid", deps), /Invalid staff/);
});
test("profile lookup failures never become missing profiles", async () => {
  const { deps, state } = fixtures({ failProfile: new Error("database unavailable") });
  await assert.rejects(resolveSignedInUserWith(user, "valid", deps), /database unavailable/);
  assert.equal(state.staff, 0);
});
test("staff service errors remain recoverable errors, not missing profiles", async () => {
  const { deps } = fixtures({ response: staffResponse(503, { error: "Try again" }) });
  await assert.rejects(resolveSignedInUserWith(user, "valid", deps), /Try again/);
});
test("no caller can resolve a different identity without a session", async () => {
  const { deps } = fixtures();
  await assert.rejects(resolveSignedInUserWith(null, "token", deps), /session/);
  await assert.rejects(resolveSignedInUserWith(user, "", deps), /session/);
});
test("repeated auth callbacks do not create profiles in the resolver", async () => {
  const { deps, state } = fixtures();
  const results = await Promise.all(Array.from({length: 20}, () =>
    resolveSignedInUserWith({ ...user, user_metadata: { business_registration: { business: "Cafe" } } }, "valid", deps)));
  assert.ok(results.every(r => r === null));
  assert.equal(state.staff, 0);
  assert.equal(state.profiles, 20);
});
