import { test, expect } from '@playwright/test';
import { setupApp } from './fixtures.js';
const tabs=['gettingStarted','overview','profile','services','hours','faqs','ai','conversations','bookings','staff','integrations','analytics','billing'];
async function noOverflow(page) {
  const overflow=await page.evaluate(() => {
    const width=document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll('body *')).filter(el => {
      const r=el.getBoundingClientRect(); const css=getComputedStyle(el);
      if (!r.width || css.position==='fixed' || el.closest('.table-frame,.sr-only') || el.classList.contains('skip-link'))return false;
      return r.right>width+2 || r.left < -2;
    }).map(el => `${el.tagName}.${el.className}`).slice(0,8);
  });
  expect(overflow).toEqual([]);
}
for (const width of [320,375,390,430,768,1024,1440,1920]) {
  test(`all workspace pages fit ${width}px`, async ({page},testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({width,height:900}); await setupApp(page);
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto("/?view=dashboard&tab=gettingStarted");
    const labels = {gettingStarted:"Getting Started",overview:"Overview",profile:"Business Profile",services:"Services & Pricing",hours:"Hours & Location",faqs:"FAQs",ai:"AI Settings",conversations:"Conversations",bookings:"Bookings",staff:"Staff",integrations:"Integrations",analytics:"Analytics",billing:"Billing"};
    await expect(page.locator("#dashboard-content h1")).toBeVisible();
    for(const tab of tabs) {
      if (width <= 900) await page.getByRole("button",{name:"Open dashboard navigation"}).click();
      const navigation = width <= 900 ? page.getByRole("dialog",{name:"Dashboard navigation"}) : page.locator(".dash-sidebar");
      await navigation.getByRole("button",{name:labels[tab],exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.locator('#dashboard-content h1')).toBeVisible();
      await expect(page.getByText('Loading workspace...', {exact:true})).toHaveCount(0);
      await noOverflow(page);
      if (tab === "overview") await expect(page.locator(".stat-card").nth(1).locator(".stat-value")).toHaveText("2");
      if(['overview','ai','billing'].includes(tab) && [390,1440].includes(width)) {
        await page.screenshot({path:testInfo.outputPath(`${tab}-${width}.png`),fullPage:true});
      }
    }
    expect(errors).toEqual([]);
  });
}
test('mobile drawer supports focus containment, Escape, destination selection and resize', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await setupApp(page); await page.goto('/?view=dashboard&tab=overview');
  const open=page.getByRole('button',{name:'Open dashboard navigation'}); await open.click();
  const drawer=page.getByRole('dialog',{name:'Dashboard navigation'}); await expect(drawer).toBeVisible();
  for(let i=0;i<22;i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(()=>!!document.activeElement.closest('dialog'))).toBe(true); }
  await page.keyboard.press('Escape'); await expect(drawer).not.toBeVisible(); await expect(open).toBeFocused();
  await open.click(); await drawer.getByRole('button',{name:'Services & Pricing'}).click();
  await expect(drawer).not.toBeVisible(); await expect(page).toHaveURL(/tab=services/); await expect(page.getByRole('heading',{name:'Services & Pricing'})).toBeVisible();
  await open.click(); await page.setViewportSize({width:1440,height:900}); await expect(drawer).not.toBeVisible();
});
test('inbox filters selected saved exchanges without inventing a resolved status', async ({page}) => {
  await setupApp(page); await page.goto('/?view=dashboard&tab=conversations');
  await page.getByRole('textbox',{name:'Search conversations'}).fill('refund');
  await expect(page.getByRole('region',{name:'Saved conversations'}).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('region',{name:'Selected message exchange'})).toContainText('Please contact staff directly');
  await page.getByRole('combobox',{name:'Conversation status'}).selectOption('not-escalated');
  await expect(page.getByRole('heading',{name:'No matching messages'})).toBeVisible();
  await expect(page.getByText('Resolved',{exact:true})).toHaveCount(0);
});
test('FAQ confirmation can be dismissed and preserves unfinished input', async ({page}) => {
  const {writes}=await setupApp(page); await page.goto('/?view=dashboard&tab=faqs');
  await page.getByRole('textbox',{name:'New FAQ question'}).fill('Unfinished question');
  const remove=page.getByRole('button',{name:'Delete FAQ'}); await remove.click();
  await expect(page.getByRole('dialog',{name:'Delete this FAQ?'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(remove).toBeFocused();
  expect(writes.filter(row=>row.method==='DELETE')).toHaveLength(0);
  await remove.click(); await page.getByRole('button',{name:'Delete FAQ',exact:true}).last().click();
  await expect(page.getByText('Are you open on Mondays?',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'New FAQ question'})).toHaveValue('Unfinished question');
  expect(writes.filter(row=>row.method==='DELETE')).toHaveLength(1);
});
test('booking is pending until staff confirms', async ({page}) => {
  await setupApp(page); await page.goto('/?view=dashboard&tab=bookings');
  await expect(page.getByRole('cell',{name:'pending',exact:true})).toBeVisible(); await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await page.getByRole('button',{name:'Confirm booking',exact:true}).click(); await expect(page.getByRole('cell',{name:'confirmed',exact:true})).toBeVisible();
});
test('staff URLs and navigation never expose owner-only pages', async ({page}) => {
  await setupApp(page,{staff:true}); await page.goto('/?view=dashboard&tab=billing');
  await expect(page.getByRole('heading',{name:'Bookings',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Billing',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'AI Settings',exact:true})).toHaveCount(0);
});
test('assistant preview uses authenticated owner endpoint and prior-only history', async ({page}) => {
  const {writes}=await setupApp(page); await page.goto('/?view=dashboard&tab=ai');
  await page.getByRole('button',{name:'What are your hours?',exact:true}).click();
  await expect(page.getByText('Your saved hours are Monday, 09:00 to 17:00.',{exact:true})).toBeVisible();
  const preview=writes.find(row=>row.path==='/assistant-preview'); expect(preview.authorization).toMatch(/^Bearer /);
  expect(preview.body.conversation.some(row=>row.text===preview.body.message)).toBe(false);
  expect(writes.filter(row=>['bookings','conversations'].includes(row.table))).toHaveLength(0);
});
test('load errors are visible instead of fabricated zero activity', async ({page}) => {
  test.setTimeout(60000);
  await setupApp(page,{fail:'conversations'}); await page.goto('/?view=dashboard&tab=overview');
  await expect(page.getByRole('alert')).toContainText('could not be loaded',{timeout:20000});
  await expect(page.locator('.stat-card').first()).toContainText('—');
});
test('URL navigation, refresh, logout, and landing styles preserve the workspace', async ({page}) => {
  await setupApp(page); await page.goto('/?view=dashboard&tab=overview');
  await page.getByRole('button',{name:'FAQs',exact:true}).click(); await expect(page).toHaveURL(/tab=faqs/);
  await page.goBack(); await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
  await page.getByRole('button',{name:'Visit website'}).click(); await expect(page.getByRole('heading',{level:1})).toContainText('Your customers have questions');
  await page.goBack(); await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
  await page.getByRole('button',{name:'Log out',exact:true}).click(); await expect(page.getByRole('heading',{level:1})).toContainText('Your customers have questions');
  expect(await page.evaluate(()=>localStorage.getItem('sb-ezeji-test-auth-token'))).toBe(null);
});
test('failed booking update remains pending with a visible error',async({page})=>{
  await setupApp(page,{failWrites:true}); await page.goto('/?view=dashboard&tab=bookings');
  await page.getByRole('button',{name:'Confirm',exact:true}).click(); await page.getByRole('button',{name:'Confirm booking',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('not saved'); await expect(page.getByRole('cell',{name:'pending',exact:true})).toBeVisible();
});
test('private preview never reads, deletes or persists customer chat history',async({page})=>{
  const {OWNER}=await import('./fixtures.js'); await setupApp(page);
  await page.addInitScript(id=>{localStorage.setItem(`nightline-chat-history-${id}`,JSON.stringify([{from:'customer',text:'Private customer history'}]));localStorage.setItem(`nightline-disappearing-messages-${id}`,'false');},OWNER);
  await page.goto('/?view=dashboard&tab=ai'); await expect(page.getByText('Private customer history',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'What are your hours?',exact:true}).click(); await expect(page.getByText('Your saved hours are Monday, 09:00 to 17:00.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear chat',exact:true}).click();
  expect(await page.evaluate(id=>JSON.parse(localStorage.getItem(`nightline-chat-history-${id}`))[0].text,OWNER)).toBe('Private customer history');
  expect(await page.evaluate(id=>localStorage.getItem(`nightline-disappearing-messages-${id}`),OWNER)).toBe('false');
});
test('services and FAQs save verified rows, and rejected deletion preserves saved content',async({page})=>{
  const {writes}=await setupApp(page,{failWrites:true}); await page.goto('/?view=dashboard&tab=services');
  await page.getByRole('textbox',{name:'Service name',exact:true}).fill('Consultation'); await page.getByRole('textbox',{name:'Service price',exact:true}).fill('NGN 5000'); await page.getByRole('textbox',{name:'Service duration',exact:true}).fill('30 min');
  await page.getByRole('button',{name:'Add item',exact:true}).click(); await expect(page.getByRole('cell',{name:'Consultation',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Delete service',exact:true}).last().click(); await page.getByRole('dialog').getByRole('button',{name:'Delete service',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Nothing was removed'); await expect(page.getByRole('cell',{name:'Consultation',exact:true})).toBeVisible();
  await page.locator('.dash-sidebar').getByRole('button',{name:'FAQs',exact:true}).click(); await page.getByRole('textbox',{name:'New FAQ question'}).fill('Do you take walk-ins?'); await page.getByRole('textbox',{name:'FAQ answer'}).fill('Please request an appointment.');
  await page.getByRole('button',{name:'Add FAQ',exact:true}).click(); await expect(page.getByText('Do you take walk-ins?',{exact:true})).toBeVisible();
  expect(writes.filter(row=>row.table==='services')).toHaveLength(1); expect(writes.filter(row=>row.table==='faqs')).toHaveLength(1);
});
test('onboarding readiness comes from saved rows and preserves selected paid plan',async({page})=>{
  await setupApp(page,{trial:true,empty:true}); await page.addInitScript(()=>localStorage.setItem('nightline-plan-selection',JSON.stringify({plan:'Professional',billingPeriod:'monthly',mode:'paid'})));
  await page.goto('/?view=dashboard&tab=gettingStarted'); await expect(page.getByRole('button',{name:'Continue to secure checkout'})).toBeDisabled();
  await page.locator('.dash-sidebar').getByRole('button',{name:'Services & Pricing',exact:true}).click(); await page.getByRole('textbox',{name:'Service name',exact:true}).fill('Consultation'); await page.getByRole('button',{name:'Add item',exact:true}).click();
  await expect(page.getByRole('cell',{name:'Consultation',exact:true})).toBeVisible(); await page.locator('.dash-sidebar').getByRole('button',{name:'Getting Started',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue to secure checkout'})).toBeEnabled(); await page.getByRole('button',{name:'Continue to secure checkout'}).click();
  await expect(page.getByRole('heading',{name:'Secure checkout'})).toBeVisible(); await expect(page.getByText('Professional plan',{exact:true})).toBeVisible();
});

test('newly registered businesses with blank hours can configure and save their week', async ({page}) => {
  const {data,writes}=await setupApp(page);
  data.profiles[0].hours_json=[];
  data.profiles[0].hours='';
  await page.goto('/?view=dashboard&tab=hours');
  await expect(page.getByRole('button',{name:'Monday: mark open'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sunday: mark open'})).toBeVisible();
  await page.getByRole('button',{name:'Monday: mark open'}).click();
  await page.getByLabel('Monday opening time',{exact:true}).fill('10:00');
  await page.getByLabel('Monday closing time',{exact:true}).fill('17:00');
  await page.getByRole('button',{name:'Save hours and location'}).click();
  await expect(page.getByRole('status')).toContainText('Saved successfully');
  const update=writes.find(row=>row.table==='profiles'&&row.method==='PATCH');
  expect(update.body.hours_json).toHaveLength(7);
  expect(update.body.hours_json[0]).toEqual(expect.objectContaining({day:'Monday',open:'10:00',close:'17:00',closed:false}));
});
test('business profile links to canonical weekly hours editor instead of accepting conflicting text',async({page})=>{
  await setupApp(page);await page.goto('/?view=dashboard&tab=profile');
  await expect(page.getByRole('textbox',{name:'Hours',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Edit weekly schedule, timezone, and location'}).click();
  await expect(page).toHaveURL(/tab=hours/);
  await expect(page.getByLabel('Monday opening time',{exact:true})).toBeVisible();
});

test('weekly hours save actual input and preserve timezone',async({page})=>{
  const {writes}=await setupApp(page); await page.goto('/?view=dashboard&tab=hours');
  await page.getByLabel('Monday opening time',{exact:true}).fill('10:00'); await page.getByRole('button',{name:'Save hours and location'}).click();
  await expect(page.getByRole('status')).toContainText('Saved successfully'); const patch=writes.find(row=>row.table==='profiles'&&row.method==='PATCH');
  expect(patch.body.hours_json[0].open).toBe('10:00'); expect(patch.body.timezone).toBe('Africa/Lagos');
});
test('the authoritative palette and reduced-motion behavior are preserved',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'}); await setupApp(page); await page.goto('/?view=dashboard&tab=overview');
  await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible();
  const tokens=await page.evaluate(()=>Object.fromEntries(['ink','ink-soft','ink-card','ink-border','paper','paper-muted','paper-faint','amber','green','red'].map(name=>[name,getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()])));
  expect(tokens).toEqual({ink:'#12131F','ink-soft':'#191B29','ink-card':'#1D1F30','ink-border':'#2B2D40',paper:'#F5F4F8','paper-muted':'#A6A5BA','paper-faint':'#6E6D85',amber:'#FFA53C',green:'#6FCF97',red:'#FF8A80'});
});
test('navigation dismisses stale confirmations before they can write in another workspace',async({page})=>{
  const {writes}=await setupApp(page); await page.goto('/?view=dashboard&tab=overview');
  await page.locator('.dash-sidebar').getByRole('button',{name:'FAQs',exact:true}).click(); await page.getByRole('button',{name:'Delete FAQ',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delete this FAQ?'})).toBeVisible(); await page.goBack();
  await expect(page.getByRole('heading',{name:'Your business at a glance'})).toBeVisible(); await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes.filter(row=>row.method==='DELETE')).toHaveLength(0);
});
