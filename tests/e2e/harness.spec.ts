// Browser test of the Phase 1 harness: real worker, real IndexedDB, phone-size viewport.
// Run: npm run build && npx vite preview --port 4173 & FAKE_DIR=<dir> npx playwright test
import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const dir = process.env.FAKE_DIR!;
const shots = process.env.SHOT_DIR ?? 'test-results';
const f = (name: string) => join(dir, name);

test.use({ viewport: { width: 390, height: 844 } });

test('upload flow on a phone-size screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4173/rewind/');
  await expect(page.getByText('Nothing yet.')).toBeVisible();
  await page.screenshot({ path: `${shots}/1-empty.png` });

  const input = page.locator('input[type=file]');

  // Older export first, then the newer overlapping one.
  await input.setInputFiles(f('fake_extended_older.zip'));
  await expect(page.getByText(/^Added /)).toBeVisible({ timeout: 60_000 });
  const firstAdded = Number((await page.getByText(/^Added /).innerText()).replace(/\D/g, ''));
  expect(firstAdded).toBeGreaterThan(1000);
  await page.screenshot({ path: `${shots}/2-first-import.png`, fullPage: true });

  await page.getByRole('button', { name: 'Done' }).click();
  await input.setInputFiles(f('fake_extended.zip'));
  await expect(page.getByText(/^Added /)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Skipped [\d,]+ duplicates/)).toBeVisible();
  await page.screenshot({ path: `${shots}/3-merge.png`, fullPage: true });

  // Same file again: nothing new.
  await page.getByRole('button', { name: 'Done' }).click();
  await input.setInputFiles(f('fake_extended.zip'));
  await expect(page.getByText('Added 0')).toBeVisible({ timeout: 60_000 });

  // Broken and unrelated files together, plus Account data.
  await page.getByRole('button', { name: 'Done' }).click();
  await input.setInputFiles([f('broken_truncated.json'), f('broken_corrupt.zip'), f('broken_unrelated.zip'), f('broken_fake.zip'), f('fake_account.zip')]);
  await expect(page.getByText(/This is your Account data/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/isn't valid JSON/)).toBeVisible();
  await expect(page.getByText(/damaged or incomplete/)).toBeVisible();
  await expect(page.getByText(/Private \(never opened\)/).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/4-errors.png`, fullPage: true });

  // Data survives a reload, then delete everything.
  await page.reload();
  await expect(page.getByText(/[\d,]+ plays$/)).toBeVisible();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await expect(page.getByText('Nothing yet.')).toBeVisible();

  expect(errors).toEqual([]);
});
