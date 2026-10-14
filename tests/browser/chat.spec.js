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
