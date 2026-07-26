import { SEESAW_URL } from './session.js';

const ROW_SELECTOR = 'li.list-group-item.sp-parent-item';

async function clickIfVisible(page, locator, timeout = 4000) {
  try {
    const first = locator.first();
    await first.waitFor({ state: 'visible', timeout });
    await first.click();
    return true;
  } catch {
    return false;
  }
}

export async function rowCount(page) {
  return page.locator(ROW_SELECTOR).count();
}

// Seesaw is an AngularJS SPA behind hash routes, and the archive list lives in a
// modal rather than on a page of its own. Walk the UI to it, tolerating the fact
// that the account menu is reached differently depending on where you start.
export async function openArchives(page, { log = () => {} } = {}) {
  if (await rowCount(page) > 0) return true;

  if (!/seesaw\.me/.test(page.url())) {
    await page.goto(SEESAW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  const openModal = async () => {
    const opened = await clickIfVisible(
      page,
      page.getByRole('button', { name: /download journal archives/i })
    ) || await clickIfVisible(
      page,
      page.locator('a, button').filter({ hasText: /download journal archives/i })
    );
    if (!opened) return false;
    try {
      await page.locator(ROW_SELECTOR).first().waitFor({ state: 'visible', timeout: 20000 });
      return true;
    } catch {
      return false;
    }
  };

  if (await openModal()) return true;

  log('Opening account settings…');
  const settingsRoutes = ['#/account_settings', '#/settings', '#/account'];
  for (const route of settingsRoutes) {
    await page.goto(SEESAW_URL + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    if (await openModal()) return true;
  }

  log('Trying the account menu…');
  await page.goto(SEESAW_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await clickIfVisible(page, page.locator('[class*="avatar"], [class*="profile"], [aria-label*="ccount"]'));
  await page.waitForTimeout(1000);
  await clickIfVisible(page, page.locator('a, button, li').filter({ hasText: /account settings/i }));
  await page.waitForTimeout(2500);
  if (await openModal()) return true;

  return false;
}

// class_id only exists on the AngularJS scope, not in the markup. Playwright runs
// in the page's main world, so unlike the extension it can read the scope directly.
export async function readArchives(page) {
  return page.evaluate((rowSelector) => {
    return [...document.querySelectorAll(rowSelector)].map((row, index) => {
      const button = row.querySelector('button.btn.btn-primary');
      let classId = '';
      let personId = '';
      try {
        const scope = window.angular && window.angular.element(button || row).scope();
        const info = scope && scope.studentClassInfo;
        if (info) {
          classId = info.class_id || '';
          personId = info.person_id || info.child_id || info.student_id || '';
        }
      } catch {
        /* scope not ready for this row */
      }
      const classEl = row.querySelector('p > strong');
      const childEl = row.querySelector('p.text-muted');
      const childMatch = childEl && childEl.textContent.match(/Child:\s*(.+)/);
      const text = row.innerText.replace(/\s+/g, ' ').trim();
      return {
        index,
        classId,
        personId,
        className: classEl ? classEl.textContent.trim() : '',
        childName: childMatch ? childMatch[1].trim() : '',
        buttonText: button ? button.innerText.replace(/\s+/g, ' ').trim() : '',
        disabled: button ? Boolean(button.disabled) : true,
        // Seesaw marks classes with nothing in them; treat those as skippable.
        looksEmpty: /no (items|posts)|empty|nothing to download/i.test(text),
        rowText: text,
      };
    });
  }, ROW_SELECTOR);
}

// After an archive is requested Seesaw puts up an alert dialog, and it sits
// over the list intercepting pointer events. Left alone, every following click
// retries against the overlay until it times out. Returns the dialog's text the
// first time it's seen so the caller can surface what Seesaw actually said.
export async function dismissAlert(page) {
  // Only the alert, never `.modal.in` generally: the archive list is itself a
  // modal, and closing that would end the run.
  const modal = page.locator('.sp-alert').first();
  if (!(await modal.count().catch(() => 0))) return null;
  if (!(await modal.isVisible().catch(() => false))) return null;

  const text = (await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

  const ok = modal.getByRole('button', { name: /^\s*(ok|close|dismiss|got it)\s*$/i }).first();
  if (await ok.count().catch(() => 0)) {
    await ok.click({ timeout: 5000 }).catch(() => {});
  } else {
    await modal.locator('button, .btn').first().click({ timeout: 5000 }).catch(() => {});
  }

  // Angular's modal fades out; wait for it to stop intercepting clicks.
  await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  });
  await page.waitForTimeout(500);
  return text;
}

// Seesaw answers a Download Journal click with an alert in more than one case,
// so callers have to read the text rather than treat any alert as meaningful.
export async function waitForAlert(page, timeout) {
  const modal = page.locator('.sp-alert').first();
  await modal.waitFor({ state: 'visible', timeout });
  return (await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

export async function clickDownload(page, index) {
  const row = page.locator(ROW_SELECTOR).nth(index);
  const button = row.locator('button.btn.btn-primary').first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

// Used by `debug` when the walk above fails, so the selectors can be re-pinned
// against whatever Seesaw is actually rendering that day.
export async function describePage(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    rows: document.querySelectorAll('li.list-group-item.sp-parent-item').length,
    listItems: document.querySelectorAll('li.list-group-item').length,
    hasAngular: Boolean(window.angular),
    buttons: [...document.querySelectorAll('button, a[role="button"]')]
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 60),
  }));
}
