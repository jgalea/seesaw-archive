#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  openContext, saveSession, clearSession, hasSavedSession, isSignedIn, SEESAW_URL, STATE_PATH,
} from './session.js';
import { openArchives, readArchives, describePage, dismissAlert } from './archives.js';
import {
  loadManifest, saveManifest, manifestKey, downloadArchive, formatBytes,
} from './download.js';
import { schoolYear, matchesYear, matchIndexes } from './names.js';
import { isInteractive, confirm, pickArchives } from './prompt.js';
import { scanArchives, dedupe, toTsv } from './links.js';

const DEFAULT_OUT = path.join(os.homedir(), 'Downloads', 'Seesaw Archives');

const USAGE = `seesaw-archive - download your children's Seesaw journal archives

Usage:
  seesaw-archive login              Sign in once (you type your own password)
  seesaw-archive list               Show every archive on the account
  seesaw-archive download           Download them all, one child folder each
  seesaw-archive links              Find content the archives link to but don't contain
  seesaw-archive debug              Dump what the page looks like right now
  seesaw-archive logout             Forget the saved session

Options:
  --out <dir>        Where to save   (default: ~/Downloads/Seesaw Archives)
  --child <name>     Only this child (substring match, repeatable)
  --year <year>      Only this school year, e.g. 2024-25 (repeatable)
  --pick             Choose from a numbered menu before downloading
  --yes, -y          Skip the confirmation prompt
  --dry-run          List what would be downloaded, download nothing
  --force            Re-download archives already recorded as done
  --include-empty    Don't skip archives that look empty
  --headless         Run without a visible window
  --limit <n>        Stop after n archives
  --fetch-script <f> links: write an rclone script to pull the linked content
  --timeout <ms>     Per-archive wait  (default: 900000, 15 min)
  --json             Machine-readable output for list/debug
`;

function parseArgs(argv) {
  const opts = { children: [], years: [], out: DEFAULT_OUT, timeout: 900000 };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--child') opts.children.push(argv[++i]);
    else if (arg === '--year') opts.years.push(argv[++i]);
    else if (arg === '--pick') opts.pick = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--timeout') opts.timeout = Number(argv[++i]);
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--fetch-script') opts.fetchScript = argv[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--include-empty') opts.includeEmpty = true;
    else if (arg === '--headless') opts.headless = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else rest.push(arg);
  }
  return { command: rest[0], opts };
}

const log = (...args) => console.log(...args);
// Progress goes to stderr so `--json` output on stdout stays parseable.
const progress = (...args) => console.error(...args);

async function requireSession() {
  if (await hasSavedSession()) return;
  console.error('No saved session. Run `seesaw-archive login` first.');
  process.exit(1);
}

async function withArchives(opts, fn) {
  await requireSession();
  const { browser, page } = await openContext({ headless: Boolean(opts.headless) });
  try {
    if (!(await isSignedIn(page))) {
      console.error('That saved session has expired. Run `seesaw-archive login` again.');
      process.exitCode = 1;
      return;
    }
    if (!(await openArchives(page, { log: progress }))) {
      console.error(
        'Could not find the Journal Archives list.\n' +
        'Open it yourself in the window (account menu → Account Settings → Download Journal Archives),\n' +
        'then run `seesaw-archive debug --json` to capture what the page looks like.'
      );
      process.exitCode = 1;
      return;
    }
    await fn(page);
  } finally {
    await browser.close();
  }
}

function selectArchives(archives, opts) {
  return archives.filter((a) => {
    if (opts.children.length &&
        !opts.children.some((c) => a.childName.toLowerCase().includes(c.toLowerCase()))) {
      return false;
    }
    if (opts.years.length && !opts.years.some((y) => matchesYear(a.className, y))) {
      return false;
    }
    if (!opts.includeEmpty && a.looksEmpty) return false;
    return true;
  });
}

// Group by child, then year, so the numbered menu reads the way a parent thinks
// about it rather than in whatever order Seesaw happened to render.
function sortArchives(archives) {
  return [...archives].sort((a, b) =>
    a.childName.localeCompare(b.childName) ||
    String(schoolYear(a.className)).localeCompare(String(schoolYear(b.className))) ||
    a.className.localeCompare(b.className));
}

function describeArchive(a) {
  const year = schoolYear(a.className);
  return `${a.className}${year ? '' : '  (no year in name)'}`;
}

async function cmdLogin(opts) {
  const { browser, context, page } = await openContext({ headless: false });
  log('A Chrome window is open at Seesaw. Sign in there with your own credentials.');
  log('This tool never sees or stores your password, only the session cookie.\n');
  await page.goto(SEESAW_URL, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + 5 * 60 * 1000;
  let signedIn = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const onLoginPage = /\/login|signin/i.test(page.url()) ||
      (await page.locator('input[type="password"]').count()) > 0;
    if (!onLoginPage && /seesaw\.me/.test(page.url())) {
      signedIn = true;
      break;
    }
  }

  if (!signedIn) {
    await browser.close();
    console.error('Timed out waiting for sign-in. Nothing was saved.');
    process.exit(1);
  }

  await saveSession(context);
  await browser.close();
  log(`Signed in. Session saved to ${STATE_PATH} (owner-only).`);
  log('Next: seesaw-archive list');
}

async function cmdList(opts) {
  await withArchives(opts, async (page) => {
    const archives = await readArchives(page);
    if (opts.json) {
      log(JSON.stringify(archives, null, 2));
      return;
    }
    if (!archives.length) {
      log('No archives found on this account.');
      return;
    }
    const selected = sortArchives(selectArchives(archives, opts));
    const byChild = new Map();
    for (const a of selected) {
      const key = a.childName || 'Unknown child';
      if (!byChild.has(key)) byChild.set(key, []);
      byChild.get(key).push(a);
    }
    for (const [child, rows] of byChild) {
      log(`\n${child}  (${rows.length})`);
      let lastYear;
      for (const row of rows) {
        const year = schoolYear(row.className) || 'no year';
        if (year !== lastYear) {
          log(`  ${year}`);
          lastYear = year;
        }
        const flags = [row.looksEmpty ? 'looks empty' : null, row.disabled ? 'disabled' : null]
          .filter(Boolean).join(', ');
        log(`    - ${row.className || '(unnamed class)'}${flags ? `  [${flags}]` : ''}`);
      }
    }
    const years = [...new Set(selected.map((a) => schoolYear(a.className)).filter(Boolean))].sort();
    log(`\n${selected.length} archive(s)${selected.length === archives.length ? '' : ` of ${archives.length}`} across ${byChild.size} child(ren).`);
    if (years.length) log(`Years: ${years.join(', ')}   (filter with --year 2024-25)`);
  });
}

async function cmdDownload(opts) {
  await withArchives(opts, async (page) => {
    const all = await readArchives(page);
    const wanted = sortArchives(selectArchives(all, opts));
    const skipped = all.length - wanted.length;

    if (!wanted.length) {
      log('Nothing to download after filtering.');
      return;
    }

    const manifest = await loadManifest(opts.out);
    let queue = wanted.filter((a) => opts.force || !manifest.downloads[manifestKey(a)]);
    const already = wanted.length - queue.length;
    if (opts.limit) queue = queue.slice(0, opts.limit);

    log(`${all.length} archive(s) on the account.`);
    if (skipped) log(`${skipped} filtered out by --child/--year or looking empty.`);
    if (already) {
      const wasEmpty = wanted.filter((a) => manifest.downloads[manifestKey(a)]?.empty).length;
      const detail = wasEmpty ? ` (${already - wasEmpty} downloaded, ${wasEmpty} empty)` : '';
      log(`${already} already handled${detail}. Use --force to redo.`);
    }

    if (opts.pick) {
      if (!isInteractive()) {
        console.error('--pick needs an interactive terminal. Use --child/--year instead.');
        process.exitCode = 1;
        return;
      }
      queue = await pickArchives(queue, {
        formatLine: describeArchive,
        groupOf: (a) => `${a.childName || 'Unknown child'}`,
        matchWord: (word) => matchIndexes(queue, word),
      });
      if (!queue.length) {
        log('Nothing selected.');
        return;
      }
    }

    log(`\n${queue.length} to fetch into ${opts.out}`);

    if (opts.dryRun) {
      for (const a of queue) log(`  would download: ${a.childName} / ${a.className}`);
      return;
    }

    // Each archive is a few hundred MB and Seesaw prepares them one at a time,
    // so a full account is an hours-long run. Worth a look before starting.
    if (!opts.yes && isInteractive()) {
      const byChild = new Map();
      for (const a of queue) byChild.set(a.childName, (byChild.get(a.childName) || 0) + 1);
      const summary = [...byChild].map(([child, n]) => `${child}: ${n}`).join(', ');
      log(`  ${summary}`);
      if (!(await confirm(`Download ${queue.length} archive(s)?`))) {
        log('Cancelled.');
        return;
      }
    }
    log('');

    let done = 0;
    let failed = 0;
    let empty = 0;
    let lastAlert = null;
    for (const archive of queue) {
      const label = `${archive.childName} / ${archive.className}`;
      log(`[${done + failed + empty + 1}/${queue.length}] ${label} …`);
      try {
        // Seesaw's own alert dialog is left open by the previous archive and
        // swallows clicks until it's closed.
        const alertText = await dismissAlert(page);
        if (alertText && alertText !== lastAlert) {
          log(`    Seesaw said: ${alertText.slice(0, 160)}`);
          lastAlert = alertText;
        }

        // Rows re-render while zips are prepared, so re-resolve this archive's
        // position by class id instead of trusting the index we read earlier.
        const current = await readArchives(page);
        const match = current.find((a) => manifestKey(a) === manifestKey(archive));
        if (!match) throw new Error('row disappeared from the list');

        const result = await downloadArchive(page, match, {
          outDir: opts.out,
          timeout: opts.timeout,
        });

        if (result.empty) {
          // Recorded like a download so re-runs don't ask Seesaw again.
          manifest.downloads[manifestKey(archive)] = {
            empty: true,
            message: result.message,
            childName: archive.childName,
            className: archive.className,
            checkedAt: new Date().toISOString(),
          };
          await saveManifest(opts.out, manifest);
          empty += 1;
          log('    empty, nothing archived for this class');
          await dismissAlert(page);
          await page.waitForTimeout(1000);
          continue;
        }

        if (result.classIdMatches === false) {
          log(`    warning: download URL points at a different class than the row`);
        }
        manifest.downloads[manifestKey(archive)] = {
          file: result.dest,
          bytes: result.bytes,
          childName: archive.childName,
          className: archive.className,
          downloadedAt: new Date().toISOString(),
        };
        await saveManifest(opts.out, manifest);
        done += 1;
        log(`    saved ${path.basename(result.dest)} (${formatBytes(result.bytes)})`);
      } catch (err) {
        failed += 1;
        log(`    failed: ${err.message.split('\n')[0]}`);
        // A failure here is nearly always about what Seesaw put on screen, so
        // record that rather than leaving only a timeout to reason about.
        try {
          const onScreen = await page.locator('.sp-alert').first()
            .innerText({ timeout: 2000 })
            .catch(() => '');
          if (onScreen) log(`    on screen: ${onScreen.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
          const shot = path.join(opts.out, `failed-${manifestKey(archive).replace(/[^\w.-]/g, '_')}.png`);
          await page.screenshot({ path: shot }).catch(() => {});
          log(`    screenshot: ${path.basename(shot)}`);
        } catch {
          /* diagnostics are best effort */
        }
      }
      await page.waitForTimeout(3000);
    }

    log(`\nDone. ${done} downloaded, ${empty} empty, ${failed} failed.`);
    if (failed) log('Re-run the same command to retry only what is missing.');
  });
}

// Photos and videos live inside the archives, but anything a teacher linked to
// instead of uploading is only a URL in the post. This reports that gap.
async function cmdLinks(opts) {
  const { archives, posts, links } = await scanArchives(opts.out);
  const unique = dedupe(links);
  const google = unique.filter((l) => l.google);
  const folders = google.filter((l) => l.kind === 'folder');

  if (opts.json) {
    log(JSON.stringify({ archives, posts, links: unique }, null, 2));
    return;
  }

  log(`Scanned ${archives} archive(s), ${posts} post(s) in ${opts.out}\n`);
  if (!unique.length) {
    log('Every post links only to media held inside the archives.');
    return;
  }

  const byClass = new Map();
  for (const l of unique) {
    const key = `${l.child} / ${l.className}`;
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(l);
  }
  for (const [cls, rows] of [...byClass].sort()) {
    log(`${cls}  (${rows.length})`);
    for (const r of rows.sort((a, b) => a.postDate.localeCompare(b.postDate))) {
      log(`  ${r.postDate}  ${r.kind.padEnd(7)} ${r.url.slice(0, 90)}`);
    }
    log('');
  }

  const tsv = path.join(opts.out, 'linked-content.tsv');
  await fs.writeFile(tsv, toTsv(unique));
  log(`${unique.length} unique link(s), ${google.length} on Google Drive.`);
  if (folders.length) log(`${folders.length} of them are folders, which may hold many photos each.`);
  log(`Written to ${tsv}`);

  if (opts.fetchScript && google.length) {
    const lines = [
      '#!/bin/bash',
      '# Fetch the Google content referenced by Seesaw posts.',
      '# Needs rclone with a Google Drive remote named "gdrive":',
      '#   rclone config create gdrive drive scope=drive.readonly',
      '# Files you no longer have access to will fail; that is expected.',
      'set -u',
      '',
    ];
    for (const l of google) {
      const dest = `"Linked Content/${l.child}/${l.className}"`;
      lines.push(`mkdir -p ${dest}`);
      lines.push(l.kind === 'folder'
        ? `rclone copy gdrive: ${dest} --drive-root-folder-id ${l.id}   # ${l.postDate}`
        : `rclone backend copyid gdrive: ${l.id} ${dest}/   # ${l.postDate} ${l.kind}`);
    }
    await fs.writeFile(opts.fetchScript, lines.join('\n') + '\n', { mode: 0o755 });
    log(`Fetch script written to ${opts.fetchScript}`);
  }
}

async function cmdDebug(opts) {
  await requireSession();
  const { browser, page } = await openContext({ headless: Boolean(opts.headless) });
  try {
    await isSignedIn(page);
    await openArchives(page, { log: () => {} });
    const info = await describePage(page);
    if (opts.json) {
      const out = path.join(opts.out, 'seesaw-debug.json');
      await fs.mkdir(opts.out, { recursive: true });
      await fs.writeFile(out, JSON.stringify(info, null, 2));
      log(`Wrote ${out}`);
    } else {
      log(JSON.stringify(info, null, 2));
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || !command) {
    log(USAGE);
    return;
  }
  switch (command) {
    case 'login': return cmdLogin(opts);
    case 'list': return cmdList(opts);
    case 'download': return cmdDownload(opts);
    case 'links': return cmdLinks(opts);
    case 'debug': return cmdDebug(opts);
    case 'logout':
      await clearSession();
      log('Saved session removed.');
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
