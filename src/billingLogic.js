export function validateCardNumber(value) {
  const digits = String(value || "").replace(/\D/g,"");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum=0, double=false;
  for (let i=digits.length-1;i>=0;i--) {
    let n=Number(digits[i]);
    if(double){n*=2;if(n>9)n-=9;}
    sum+=n;double=!double;
  }
  return sum%10===0;
}
export function validateExpiry(value) {
  const match=String(value||"").match(/^(\d{2})\/(\d{2})$/);
  if(!match)return false;
  const month=Number(match[1]), year=Number(match[2]);
  if(month<1||month>12)return false;
  const now=new Date(),currentYear=now.getFullYear()%100,currentMonth=now.getMonth()+1;
  return year>currentYear||(year===currentYear&&month>=currentMonth);
}
export function validateCvc(value) {
  return /^\d{3,4}$/.test(String(value||"").replace(/\D/g,""));
}

// Only NGN Paystack checkout exists. Never display a guessed USD/GHS/KES/ZAR
// amount as if it were payable. NGN amounts here are whole naira.
export const NGN_PLAN_PRICES = Object.freeze({
  "14-day trial": Object.freeze({monthlyNgn:0,yearlyNgn:0,isTrial:true,trialDays:14}),
  Starter: Object.freeze({monthlyNgn:15000,yearlyNgn:150000,isTrial:false,trialDays:0}),
  Professional: Object.freeze({monthlyNgn:35000,yearlyNgn:350000,isTrial:false,trialDays:0}),
  Business: Object.freeze({monthlyNgn:75000,yearlyNgn:750000,isTrial:false,trialDays:0}),
});
export function getPlanDetails(plan, _currency="NGN", billingPeriod="monthly") {
  const normalized=plan==="Free trial"?"14-day trial":plan;
  const config=NGN_PLAN_PRICES[normalized];
  if(!config)throw new RangeError("Unknown billing plan");
  if(billingPeriod!=="monthly"&&billingPeriod!=="yearly")throw new RangeError("Unknown billing period");
  const amountDue=billingPeriod==="yearly"?config.yearlyNgn:config.monthlyNgn;
  const displayPrice=`NGN ${amountDue.toLocaleString("en-NG")}`;
  return {
    name:normalized,monthlyNgn:config.monthlyNgn,yearlyNgn:config.yearlyNgn,
    amountDue,isTrial:config.isTrial,displayPrice,secondaryPrice:displayPrice,
    trialDays:config.trialDays,billingPeriod,
    periodLabel:billingPeriod==="yearly"?"billed yearly":"billed monthly",
  };
}
export function getTrialEndsAt(days=14) {
  return new Date(Date.now()+days*24*60*60*1000).toISOString();
}
