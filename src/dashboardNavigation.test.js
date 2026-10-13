import test from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardTab, dashboardUrlForTab } from "./dashboardNavigation.js";

test("owner direct links resolve and invalid tabs use the expected landing tab", () => {
  assert.equal(resolveDashboardTab("?view=dashboard&tab=services"), "services");
  assert.equal(resolveDashboardTab("?tab=not-a-page", false, "gettingStarted"), "gettingStarted");
});
test("staff cannot resolve or navigate to owner billing even through a crafted URL", () => {
  assert.equal(resolveDashboardTab("?tab=billing", true), "bookings");
  assert.throws(() => dashboardUrlForTab("https://ezeji.example/?view=dashboard", "billing", true), RangeError);
});
test("dashboard navigation preserves unrelated query and fragment without losing deep links", () => {
  const path = dashboardUrlForTab("https://ezeji.example/?source=email#help", "faqs");
  assert.equal(path, "/?source=email&view=dashboard&tab=faqs#help");
  assert.equal(resolveDashboardTab(path.split("?")[1].split("#")[0]), "faqs");
});
