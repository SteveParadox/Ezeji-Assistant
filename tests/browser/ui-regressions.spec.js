import { test, expect } from '@playwright/test';
import { setupApp, OWNER } from './fixtures.js';

test('business profile no longer advertises Saved after unsaved edits', async ({ page }) => {
  await setupApp(page);
  await page.goto('/?view=dashboard&tab=profile');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved successfully')).toBeVisible();
  await page.getByRole('textbox', { name: 'Business name' }).fill('New unsaved business name');
  await expect(page.getByText('Saved successfully')).toHaveCount(0);
});

test('assistant voice no longer advertises Saved after unsaved edits', async ({ page }) => {
  await setupApp(page);
  await page.goto('/?view=dashboard&tab=ai');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved successfully')).toBeVisible();
  await page.getByRole('textbox', { name: 'Assistant name' }).fill('New unsaved assistant name');
  await expect(page.getByText('Saved successfully')).toHaveCount(0);
});

test('business hours no longer advertise Saved after unsaved edits', async ({ page }) => {
  await setupApp(page);
  await page.goto('/?view=dashboard&tab=hours');
  await page.getByRole('button', { name: 'Save hours and location' }).click();
  await expect(page.getByText('Saved successfully')).toBeVisible();
  await page.getByRole('textbox', { name: 'Street address' }).fill('Uncommitted street address');
  await expect(page.getByText('Saved successfully')).toHaveCount(0);
});

test('WhatsApp setup never offers an unreachable localhost webhook as a real callback', async ({ page }) => {
  await setupApp(page);
  await page.goto('/?view=dashboard&tab=integrations');
  await expect(page.getByText(/No valid public HTTPS callback is configured/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Deployed callback URL (read only)' })).toHaveCount(0);
  await expect(page.getByText('http://localhost:5174/webhook/whatsapp')).toHaveCount(0);
});

test('customer local-history preference does not falsely promise server deletion', async ({ page }) => {
  await setupApp(page);
  await page.goto(`/?view=chat&biz=${OWNER}`);
  await expect(page.getByRole('button', { name: /Stop storing messages on this device/ })).toBeVisible();
  await expect(page.getByText(/business may still retain customer exchanges on its server/)).toBeVisible();
});
