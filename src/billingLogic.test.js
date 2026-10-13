import test from "node:test";
import assert from "node:assert/strict";
import { getPlanDetails, NGN_PLAN_PRICES } from "./billingLogic.js";

test("yearly billing returns NGN annual amount and label",()=>{
  const details=getPlanDetails("Professional","USD","yearly");
  assert.equal(details.amountDue,350000);
  assert.equal(details.billingPeriod,"yearly");
  assert.equal(details.periodLabel,"billed yearly");
  assert.equal(details.displayPrice,"NGN 350,000");
});
test("monthly billing returns NGN base amount",()=>{
  const details=getPlanDetails("Starter","USD","monthly");
  assert.equal(details.amountDue,15000);
  assert.equal(details.periodLabel,"billed monthly");
});
test("unsupported display currencies never masquerade as provider charges",()=>{
  for(const requested of ["GHS","KES","ZAR","USD","NGN"]) {
    const result=getPlanDetails("Professional",requested,"monthly");
    assert.equal(result.amountDue,35000);
    assert.match(result.displayPrice,/NGN 35,000/);
  }
});
test("all plan amounts are exact whole-naira values convertible to Paystack kobo",()=>{
  for(const plan of ["Starter","Professional","Business"]) {
    for(const period of ["monthly","yearly"]) {
      const details=getPlanDetails(plan,"NGN",period);
      assert.equal(details.amountDue*100,NGN_PLAN_PRICES[plan][period==="monthly"?"monthlyNgn":"yearlyNgn"]*100);
      assert.ok(Number.isSafeInteger(details.amountDue*100));
    }
  }
});
test("unknown billing plan and billing period are refused",()=>{
  assert.throws(()=>getPlanDetails("AdminOnly"),/Unknown billing plan/);
  assert.throws(()=>getPlanDetails("Starter","NGN","decade"),/Unknown billing period/);
});
