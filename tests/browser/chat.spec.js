import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {setupApp,OWNER} from './fixtures';
const url=`/?view=chat&biz=${OWNER}`;
test('customer chat uses isolated server session, restores after refresh, and distinguishes new conversation from deletion',async({page},testInfo)=>{
 const {writes}=await setupApp(page,{signedIn:false});await page.goto(url);
 const input=page.getByRole('textbox',{name:'Message to assistant'});await input.fill('Haircut price?');await input.press('Enter');
 await expect(page.getByText('Haircut costs NGN 15000.',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('customer-chat-desktop.png'),fullPage:true});
 const first=writes.find(x=>x.path==='/assistant-reply').body;expect(first.conversation).toBeUndefined();expect(first.sessionToken).toMatch(/^[a-f0-9]{64}$/);
 await page.reload();await expect(page.getByText('Haircut price?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Start new conversation',exact:true}).click();await expect(page.getByText(/Earlier server records remain/)).toBeVisible();
 await input.fill('Hello');await input.press('Enter');await expect(page.getByText('Haircut costs NGN 15000.',{exact:true})).toBeVisible();
 expect(writes.filter(x=>x.path==='/assistant-reply').at(-1).body.sessionToken).not.toBe(first.sessionToken);
 await page.getByRole('button',{name:'Delete this server conversation'}).click();await page.getByRole('button',{name:'Delete conversation',exact:true}).click();await expect(page.getByText(/Chat content deleted/)).toBeVisible();
});
test('failed message retries its original identity without a duplicate user bubble',async({page})=>{
 await setupApp(page,{signedIn:false});let calls=[];
 await page.route('http://127.0.0.1:5174/assistant-reply',route=>{const body=route.request().postDataJSON();calls.push(body);return route.fulfill(calls.length===1?{status:503,json:{error:'Assistant temporarily unavailable'}}:{json:{reply:'Verified reply',provider:'groq'}});});
 await page.goto(url);const input=page.getByRole('textbox',{name:'Message to assistant'});await input.fill('Test retry');await input.press('Enter');
 await expect(page.getByRole('button',{name:'Retry last message'})).toBeVisible();await page.getByRole('button',{name:'Retry last message'}).click();
 await expect(page.getByText('Verified reply',{exact:true})).toBeVisible();expect(calls[1].requestId).toBe(calls[0].requestId);expect(calls[1].sessionToken).toBe(calls[0].sessionToken);
 await expect(page.getByText('Test retry',{exact:true})).toHaveCount(1);
});
test('multiline composition, loading guard, keyboard controls and narrow layout are accessible',async({page},testInfo)=>{
 await setupApp(page,{signedIn:false});let resolve;let count=0;
 await page.route('http://127.0.0.1:5174/assistant-reply',async route=>{count++;await new Promise(r=>resolve=r);await route.fulfill({json:{reply:'Saved facts reply',provider:'groq'}});});
 await page.setViewportSize({width:320,height:760});await page.goto(url);
 const input=page.getByRole('textbox',{name:'Message to assistant'});await input.fill('Line one');await input.press('Shift+Enter');await input.type('Line two');expect(await input.inputValue()).toContain('\n');
 await input.press('Enter');await expect(page.getByRole('status',{name:'Assistant is processing your message'})).toBeVisible();await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();expect(count).toBe(1);
 resolve();await expect(page.getByText('Saved facts reply',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('customer-chat-mobile.png'),fullPage:true});
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations).toEqual([]);
});
test('owner activation is saved through authenticated backend settings',async({page})=>{
 const {writes}=await setupApp(page);await page.goto('/?view=dashboard&tab=ai');await expect(page.getByRole('button',{name:'Pause customer assistant'})).toBeVisible();
 await page.getByRole('button',{name:'Pause customer assistant'}).click();await expect(page.getByRole('button',{name:'Activate customer assistant'})).toBeVisible();
 expect(writes.find(x=>x.path.startsWith('/assistant-settings/')&&x.body.active===false)).toBeTruthy();
});
test('booking form requires review and explicit confirmation before saving a pending request',async({page})=>{
 const {writes}=await setupApp(page,{signedIn:false});await page.goto(url);
 await page.getByRole('button',{name:'Request appointment',exact:true}).click();
 await page.getByRole('textbox',{name:'Customer name',exact:true}).fill('Ada');await page.getByRole('textbox',{name:'Customer email or phone'}).fill('ada@example.test');
 await page.getByRole('combobox',{name:'Booking service'}).selectOption('service-1');await page.getByLabel('Requested appointment date and time').fill('2026-10-20T10:00');
 await page.getByRole('button',{name:'Review booking request'}).click();expect(writes.filter(w=>w.path==='/assistant-booking-request')).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm and submit pending request'}).click();await expect(page.getByText(/saved for staff review.*NOT a confirmed appointment/)).toBeVisible();
 const payload=writes.find(w=>w.path==='/assistant-booking-request').body;expect(payload.confirmed).toBe(true);expect(payload.sessionToken).toMatch(/^[a-f0-9]{64}$/);
});
test('restored committed reply clears an interrupted request and is not duplicated on retry',async({page})=>{
 const {writes}=await setupApp(page,{signedIn:false});await page.goto(url);
 const input=page.getByRole('textbox',{name:'Message to assistant'});await input.fill('Price please');await input.press('Enter');await expect(page.getByText('Haircut costs NGN 15000.',{exact:true})).toBeVisible();
 const payload=writes.find(w=>w.path==='/assistant-reply').body;
 await page.evaluate(({id,payload})=>sessionStorage.setItem(`ezeji-pending-customer-${id}`,JSON.stringify(payload)),{id:OWNER,payload});
 await page.reload();await expect(page.getByText('Haircut costs NGN 15000.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Retry last message'})).toHaveCount(0);
 await expect(page.getByText('Price please',{exact:true})).toHaveCount(1);expect(writes.filter(w=>w.path==='/assistant-reply')).toHaveLength(1);
});
test('booking recovery preserves original input and request ID after a lost response and refresh',async({page})=>{
 await setupApp(page,{signedIn:false});const submitted=[];
 await page.route('http://127.0.0.1:5174/assistant-booking-request',route=>{submitted.push(route.request().postDataJSON());return route.fulfill(submitted.length===1?{status:503,json:{error:'Booking result awaiting recovery'}}:{json:{bookingId:'saved-pending-booking',status:'pending'}});});
 await page.goto(url);await page.getByRole('button',{name:'Request appointment',exact:true}).click();
 await page.getByRole('textbox',{name:'Customer name',exact:true}).fill('Ada');await page.getByRole('textbox',{name:'Customer email or phone'}).fill('ada@example.test');await page.getByRole('combobox',{name:'Booking service'}).selectOption('service-1');await page.getByLabel('Requested appointment date and time').fill('2026-10-20T10:00');
 await page.getByRole('button',{name:'Review booking request'}).click();await page.getByRole('button',{name:'Confirm and submit pending request'}).click();await expect(page.getByText(/previous submission may have succeeded/)).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Customer name',exact:true})).toBeDisabled();await page.reload();
 await expect(page.getByRole('textbox',{name:'Customer name',exact:true})).toHaveValue('Ada');await page.getByRole('button',{name:'Confirm and submit pending request'}).click();await expect(page.getByText(/saved for staff review/)).toBeVisible();
 expect(submitted[1]).toEqual(submitted[0]);
});
test('an in-flight booking cannot be detached by starting or deleting the conversation',async({page})=>{
 await setupApp(page,{signedIn:false});let release;
 await page.route('http://127.0.0.1:5174/assistant-booking-request',async route=>{await new Promise(r=>release=r);await route.fulfill({json:{bookingId:'verified-booking',status:'pending'}});});
 await page.goto(url);await page.getByRole('button',{name:'Request appointment',exact:true}).click();
 await page.getByRole('textbox',{name:'Customer name',exact:true}).fill('Ada');await page.getByRole('textbox',{name:'Customer email or phone'}).fill('ada@example.test');await page.getByRole('combobox',{name:'Booking service'}).selectOption('service-1');await page.getByLabel('Requested appointment date and time').fill('2026-10-20T10:00');
 await page.getByRole('button',{name:'Review booking request'}).click();await page.getByRole('button',{name:'Confirm and submit pending request'}).click();
 await expect(page.getByRole('button',{name:'Start new conversation'})).toBeDisabled();await expect(page.getByRole('button',{name:'Delete this server conversation'})).toBeDisabled();
 release();await expect(page.getByText(/saved for staff review/)).toBeVisible();await expect(page.getByRole('button',{name:'Start new conversation'})).toBeEnabled();
});
test('pausing the assistant does not silently save unfinished policy edits',async({page})=>{
 const {writes}=await setupApp(page);await page.goto('/?view=dashboard&tab=ai');await page.getByText('Business policies and language preferences',{exact:true}).click();await page.getByRole('textbox',{name:'Refund policy',exact:true}).fill('This draft should remain unsaved.');
 await page.getByRole('button',{name:'Pause customer assistant'}).click();await expect(page.getByRole('button',{name:'Activate customer assistant'})).toBeVisible();
 expect(writes.find(w=>w.path.startsWith('/assistant-settings/')).body).toEqual({active:false});await expect(page.getByRole('textbox',{name:'Refund policy',exact:true})).toHaveValue('This draft should remain unsaved.');
});

test('handoff controls wait for verified thread data and reject mismatched save receipts',async({page})=>{
 await setupApp(page);const thread={id:'customer-thread',business_id:OWNER,channel:'web',status:'automated',updated_at:new Date().toISOString()};let load,save;const mutations=[];
 await page.route('http://127.0.0.1:5174/assistant-inbox/**',async route=>{
  if(route.request().method()==='PATCH'){mutations.push(route.request().postDataJSON());await new Promise(r=>save=r);return route.fulfill({json:{status:'automated'}});}
  if(new URL(route.request().url()).pathname.endsWith('/customer-thread')){await new Promise(r=>load=r);return route.fulfill({json:{thread,messages:[]}});}
  return route.fulfill({json:{threads:[thread]}});
 });
 await page.goto('/?view=dashboard&tab=conversations');await page.getByRole('button',{name:/Customer conversation/}).click();
 await expect(page.getByRole('button',{name:'Pause automation for staff'})).toBeDisabled();load();await expect(page.getByRole('button',{name:'Pause automation for staff'})).toBeEnabled();
 await page.getByRole('button',{name:'Pause automation for staff'}).click();await expect(page.getByRole('button',{name:/Customer conversation/})).toBeDisabled();save();
 await expect(page.getByRole('alert').filter({hasText:'Handoff change was not verified.'})).toBeVisible();await expect(page.getByText('Status: automated',{exact:true})).toBeVisible();expect(mutations).toEqual([{status:'human'}]);
});
