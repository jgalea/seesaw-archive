import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.seesaw-archive');
export const STATE_PATH = path.join(CONFIG_DIR, 'state.json');
export const SEESAW_URL = 'https://app.seesaw.me/';

export async function hasSavedSession() {
  try {
    await fs.access(STATE_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function saveSession(context) {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await context.storageState({ path: STATE_PATH });
  await fs.chmod(STATE_PATH, 0o600);
}

export async function clearSession() {
  await fs.rm(STATE_PATH, { force: true });
}

// The session cookie is the only credential this tool ever touches, and the user
// types their password themselves in a visible window during `login`.
export async function openContext({ headless = false, downloadsPath } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: (await hasSavedSession()) ? STATE_PATH : undefined,
    acceptDownloads: true,
    viewport: { width: 1400, height: 950 },
    ...(downloadsPath ? { downloadsPath } : {}),
  });
  const page = await context.newPage();
  return { browser, context, page };
}

export async function isSignedIn(page) {
  await page.goto(SEESAW_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const url = page.url();
  if (/\/login|signin|\/#\/login/i.test(url)) return false;
  const loginForm = await page.locator('input[type="password"]').count();
  return loginForm === 0;
}
