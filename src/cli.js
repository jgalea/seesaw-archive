#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  openContext, saveSession, clearSession, hasSavedSession, isSignedIn, SEESAW_URL, STATE_PATH,
} from './session.js';
import { openArchives, readArchives, describePage } from './archives.js';
import {
  loadManifest, saveManifest, manifestKey, downloadArchive, formatBytes,
} from './download.js';

const DEFAULT_OUT = path.join(os.homedir(), 'Downloads', 'Seesaw Archives');

const USAGE = `seesaw-archive - download your children's Seesaw journal archives

Usage:
  seesaw-archive login              Sign in once (you type your own password)
  seesaw-archive list               Show every archive on the account
  seesaw-archive download           Download them all, one child folder each
  seesaw-archive debug              Dump what the page looks like right now
  seesaw-archive logout             Forget the saved session

Options:
  --out <dir>        Where to save   (default: ~/Downloads/Seesaw Archives)
  --child <name>     Only this child (substring match, repeatable)
  --dry-run          List what would be downloaded, download nothing
  --force            Re-download archives already recorded as done
  --include-empty    Don't skip archives that look empty
  --headless         Run without a visible window
  --limit <n>        Stop after n archives
  --timeout <ms>     Per-archive wait  (default: 900000, 15 min)
  --json             Machine-readable output for list/debug
`;

function parseArgs(argv) {
  const opts = { children: [], out: DEFAULT_OUT, timeout: 900000 };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--child') opts.children.push(argv[++i]);
    else if (arg === '--timeout') opts.timeout = Number(argv[++i]);
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
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
    if (!opts.includeEmpty && a.looksEmpty) return false;
    return true;
  });
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
    const byChild = new Map();
    for (const a of archives) {
      const key = a.childName || 'Unknown child';
      if (!byChild.has(key)) byChild.set(key, []);
      byChild.get(key).push(a);
    }
    for (const [child, rows] of byChild) {
      log(`\n${child}  (${rows.length})`);
      for (const row of rows) {
        const flags = [row.looksEmpty ? 'looks empty' : null, row.disabled ? 'disabled' : null]
          .filter(Boolean).join(', ');
        log(`  - ${row.className || '(unnamed class)'}${flags ? `  [${flags}]` : ''}`);
      }
    }
    log(`\n${archives.length} archive(s) total.`);
  });
}

async function cmdDownload(opts) {
  await withArchives(opts, async (page) => {
    const all = await readArchives(page);
    const wanted = selectArchives(all, opts);
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
    if (skipped) log(`${skipped} filtered out (empty or child filter).`);
    if (already) log(`${already} already downloaded (use --force to redo).`);
    log(`${queue.length} to fetch into ${opts.out}\n`);

    if (opts.dryRun) {
      for (const a of queue) log(`  would download: ${a.childName} / ${a.className}`);
      return;
    }

    let done = 0;
    let failed = 0;
    for (const archive of queue) {
      const label = `${archive.childName} / ${archive.className}`;
      log(`[${done + failed + 1}/${queue.length}] ${label} …`);
      try {
        // Rows re-render while zips are prepared, so re-resolve this archive's
        // position by class id instead of trusting the index we read earlier.
        const current = await readArchives(page);
        const match = current.find((a) => manifestKey(a) === manifestKey(archive));
        if (!match) throw new Error('row disappeared from the list');

        const result = await downloadArchive(page, match, {
          outDir: opts.out,
          timeout: opts.timeout,
        });

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
        log(`    failed: ${err.message}`);
      }
      await page.waitForTimeout(3000);
    }

    log(`\nDone. ${done} downloaded, ${failed} failed.`);
    if (failed) log('Re-run the same command to retry only what is missing.');
  });
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
