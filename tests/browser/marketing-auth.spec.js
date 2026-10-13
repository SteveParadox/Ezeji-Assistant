import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setupApp } from './fixtures.js';
for(const width of [320,375,390,430,768,1024,1440,1920]) {
  test(`landing and four-field signup fit ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900}); await setupApp(page,{signedIn:false}); await page.goto('/');
    await expect(page.getByRole('heading',{level:1})).toContainText('Your customers have questions');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if([390,1440].includes(width)) await page.screenshot({path:testInfo.outputPath(`landing-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Start your free trial',exact:true}).first().click();
    await expect(page.getByRole('heading',{name:'Create your account'})).toBeVisible();
    await expect(page.locator('form input')).toHaveCount(4);
    const fields=await page.locator('form input').evaluateAll(inputs=>inputs.map(input=>input.getBoundingClientRect().right)); expect(fields.every(right=>right<=width)).toBe(true);
    if([390,1440].includes(width)) await page.screenshot({path:testInfo.outputPath(`signup-${width}.png`),fullPage:true});
  });
}
test('mobile marketing drawer closes with Escape and section selection',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await setupApp(page,{signedIn:false}); await page.goto('/');
  const toggle=page.getByRole('button',{name:'Open navigation',exact:true}); await toggle.click();
  const drawer=page.getByRole('dialog',{name:'Website navigation'}); await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape'); await expect(drawer).not.toBeVisible(); await expect(toggle).toBeFocused();
  await toggle.click(); await drawer.getByRole('link',{name:'Pricing',exact:true}).click(); await expect(drawer).not.toBeVisible(); await expect(page).toHaveURL(/#pricing/);
});
test('signup without an immediate Supabase session reaches email verification and keeps the selected plan',async({page})=>{
  const {writes}=await setupApp(page,{signedIn:false}); await page.goto('/');
  await page.getByRole('button',{name:'Choose Professional'}).click();
  await page.getByRole('textbox',{name:'Full name',exact:true}).fill('Stephen'); await page.getByRole('textbox',{name:'Business name',exact:true}).fill('Bloom');
  await page.getByRole('textbox',{name:'Email address',exact:true}).fill('stephen@example.test'); await page.getByLabel('Password (at least 8 characters)',{exact:true}).fill('correct-test-password');
  await page.getByLabel('Password (at least 8 characters)',{exact:true}).press('Enter');
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();
  expect(writes.find(row=>row.table==='signup').body.data.business_registration.business).toBe('Bloom');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nightline-plan-selection')).plan)).toBe('Professional');
});
test('password controls and keyboard login submission work',async({page})=>{
  await setupApp(page,{signedIn:false}); await page.goto('/'); await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@example.test'); await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Show password'}).click(); await expect(page.getByLabel('Password',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Hide password'}).click(); await page.getByLabel('Password',{exact:true}).press('Enter');
  await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
});
test('recovery callback exposes new-password form and session-bound save',async({page})=>{
  await setupApp(page,{signedIn:false}); await page.goto('/?auth_callback=recovery&token_hash=test-token&type=recovery');
  await expect(page.getByRole('heading',{name:'Choose a new password'})).toBeVisible();
  await page.getByLabel('New password (8+ characters)',{exact:true}).fill('new-test-password'); await page.getByLabel('Confirm new password',{exact:true}).fill('new-test-password');
  await page.getByRole('button',{name:'Update password'}).click(); await expect(page.getByText('Your password has been changed. Sign in with your new password.')).toBeVisible();
});
test('pending payment keeps exact reference despite a prior active same-plan subscription',async({page})=>{
  await setupApp(page,{payment:'pending'}); await page.addInitScript(()=>{localStorage.setItem('ezeji-last-checkout-ref','test-ref');localStorage.setItem('nightline-plan-selection',JSON.stringify({plan:'Professional',billingPeriod:'monthly',mode:'paid'}));});
  await page.goto('/?checkout=success&reference=test-ref'); await expect(page.getByRole('heading',{name:'Checking your payment'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('still pending');
  expect(await page.evaluate(()=>localStorage.getItem('ezeji-last-checkout-ref'))).toBe('test-ref');
  await page.getByRole('button',{name:'Open billing without dismissing payment verification'}).click(); await expect(page.getByRole('heading',{name:'Billing',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('ezeji-last-checkout-ref'))).toBe('test-ref');
});
test('only settled payment clears reference and returns to active dashboard',async({page})=>{
  await setupApp(page,{payment:'paid'}); await page.addInitScript(()=>localStorage.setItem('ezeji-last-checkout-ref','test-ref'));
  await page.goto('/?checkout=success&reference=test-ref'); await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('ezeji-last-checkout-ref'))).toBe(null); await expect(page).not.toHaveURL(/reference=/);
});
test('landing, signup and all workspace pages have no automated WCAG A/AA violations',async({page})=>{
  test.setTimeout(180000); await setupApp(page,{signedIn:false}); await page.goto('/');
  const audit=async()=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);};
  await audit(); await page.getByRole('button',{name:'Start your free trial',exact:true}).first().click(); await audit();
  await page.getByRole('button',{name:'Log in',exact:true}).click(); await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@example.test'); await page.getByLabel('Password',{exact:true}).fill('test-password'); await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
  for(const name of ['Overview','Getting Started','Business Profile','AI Settings','FAQs','Services & Pricing','Hours & Location','Conversations','Bookings','Staff','Integrations','Analytics','Billing']) {
    await page.locator('.dash-sidebar').getByRole('button',{name,exact:true}).click(); await expect(page.locator('#dashboard-content h1')).toBeVisible(); await audit();
  }
});
