import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlanDetails } from './billingLogic.js';

test('yearly billing returns annual amount and yearly label', () => {
  const details = getPlanDetails('Professional', 'USD', 'yearly');

  assert.equal(details.amountDue, 350000);
  assert.equal(details.billingPeriod, 'yearly');
  assert.equal(details.periodLabel, 'billed yearly');
});

test('monthly billing returns the base monthly amount', () => {
  const details = getPlanDetails('Starter', 'USD', 'monthly');

  assert.equal(details.amountDue, 15000);
  assert.equal(details.billingPeriod, 'monthly');
  assert.equal(details.periodLabel, 'billed monthly');
});

test('all supported selections bill in NGN', () => {
  for (const requested of ['GHS','KES','ZAR','USD']) {
    const result=getPlanDetails('Professional', requested, 'monthly');
    assert.equal(result.amountDue,35000);
    assert.match(result.displayPrice,/NGN 35,000/);
  }
});
