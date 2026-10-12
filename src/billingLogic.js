export function validateCardNumber(value) {
  const digits = `${value || ''}`.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

export function validateExpiry(value) {
  const match = `${value || ''}`.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return false;

  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  return true;
}

export function validateCvc(value) {
  return /^\d{3,4}$/.test(`${value || ''}`.replace(/\D/g, ''));
}

// Plan prices are modeled in USD for the general pricing utility, while the
// app's live checkout still uses NGN values for Paystack. The test suite
// expects both styles to be supported by this helper.
const USD_PLAN_MAP = {
  '14-day trial': { monthlyUsd: 0, yearlyUsd: 0, isTrial: true, trialDays: 14 },
  Starter: { monthlyUsd: 29, yearlyUsd: 290, isTrial: false, trialDays: 0 },
  Professional: { monthlyUsd: 79, yearlyUsd: 790, isTrial: false, trialDays: 0 },
  Business: { monthlyUsd: 149, yearlyUsd: 1490, isTrial: false, trialDays: 0 },
};

const NGN_PLAN_MAP = {
  '14-day trial': { monthlyNgn: 0, yearlyNgn: 0, isTrial: true, trialDays: 14 },
  Starter: { monthlyNgn: 15000, yearlyNgn: 150000, isTrial: false, trialDays: 0 },
  Professional: { monthlyNgn: 35000, yearlyNgn: 350000, isTrial: false, trialDays: 0 },
  Business: { monthlyNgn: 75000, yearlyNgn: 750000, isTrial: false, trialDays: 0 },
};

const CURRENCY_RATES = {
  USD: 1,
  GHS: 16,
  KES: 160,
  ZAR: 18,
};

function formatCurrency(amount, currency) {
  const normalized = `${currency || 'USD'}`.toUpperCase();

  if (normalized === 'USD') return `$${amount.toLocaleString('en-US')}`;
  if (normalized === 'GHS') return `GH₵${amount.toLocaleString('en-US')}`;
  if (normalized === 'KES') return `KSh${amount.toLocaleString('en-US')}`;
  if (normalized === 'ZAR') return `R${amount.toLocaleString('en-US')}`;
  if (normalized === 'NGN') return `NGN ${amount.toLocaleString('en-US')}`;

  return `${normalized} ${amount.toLocaleString('en-US')}`;
}

export function getPlanDetails(plan, currency = 'NGN', billingPeriod = 'monthly') {
  const normalized = plan === 'Free trial' ? '14-day trial' : plan;
  const normalizedBillingPeriod = billingPeriod === 'yearly' ? 'yearly' : 'monthly';
  const currencyCode = `${currency || 'NGN'}`.toUpperCase();

  let base;
  let amountDue;

  if (currencyCode === 'NGN') {
    base = NGN_PLAN_MAP[normalized] || NGN_PLAN_MAP.Starter;
    amountDue = normalizedBillingPeriod === 'yearly' ? base.yearlyNgn : base.monthlyNgn;
  } else {
    base = USD_PLAN_MAP[normalized] || USD_PLAN_MAP.Starter;
    const usdAmount = normalizedBillingPeriod === 'yearly'
      ? base.yearlyUsd
      : base.monthlyUsd;

    if (currencyCode === 'USD') {
      amountDue = usdAmount;
    } else {
      const rate = CURRENCY_RATES[currencyCode] || 1;
      amountDue = Math.round(usdAmount * rate);
    }
  }

  const displayPrice = formatCurrency(amountDue, currencyCode);
  const periodLabel = normalizedBillingPeriod === 'yearly' ? 'billed yearly' : 'billed monthly';

  return {
    name: normalized,
    monthlyNgn: NGN_PLAN_MAP[normalized]?.monthlyNgn ?? 15000,
    yearlyNgn: NGN_PLAN_MAP[normalized]?.yearlyNgn ?? 150000,
    amountDue,
    isTrial: Boolean(base?.isTrial),
    displayPrice,
    secondaryPrice: displayPrice,
    trialDays: base?.trialDays ?? 0,
    billingPeriod: normalizedBillingPeriod,
    periodLabel,
  };
}

export function getTrialEndsAt(days = 14) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}