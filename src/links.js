// Seesaw posts can be link items: a preview image plus a target URL. The
// downloadable archive keeps the image, the caption and the date, but drops the
// URL, so a post reading "all the pictures here!" arrives as a screenshot of a
// Drive folder with no way back to it. The only place those targets exist is
// the live journal feed, which is what this reads.

import { safeDirName } from './names.js';

const GOOGLE = /https?:\/\/(?:docs|drive)\.google\.com[^\s"'<>)\\\]]+/g;

export function isGoogle(url) {
  return /^https?:\/\/(docs|drive)\.google\.com/i.test(url);
}

export function googleId(url) {
  const folder = url.match(/drive\/folders\/([A-Za-z0-9_-]+)/);
  if (folder) return { id: folder[1], kind: 'folder' };
  const file = url.match(/\/(document|presentation|spreadsheets|file|forms)\/d\/(?:e\/)?([A-Za-z0-9_-]+)/);
  if (file) {
    const kinds = {
      document: 'doc',
      presentation: 'slides',
      spreadsheets: 'sheet',
      file: 'file',
      forms: 'form',
    };
    return { id: file[2], kind: kinds[file[1]] };
  }
  return null;
}

// URLs arrive inside JSON payloads, so they carry escaping and trailing quotes.
export function cleanUrl(raw) {
  return raw
    .replace(/\\\//g, '/')
    .replace(/\\u002F/gi, '/')
    .replace(/["'\\].*$/, '')
    .replace(/[.,;]+$/, '');
}

export function extractGoogleUrls(text) {
  // Unescape first: in JSON payloads the slashes arrive as \/ , and matching
  // before unescaping truncates every URL at its first backslash.
  const plain = String(text).replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  return [...new Set((plain.match(GOOGLE) || []).map(cleanUrl))].filter(isGoogle);
}

export function feedUrl(personId, classId) {
  return `https://app.seesaw.me/#/family/journals/${personId}/${classId}`;
}

// Walks one class feed to its end, collecting every Google URL the app fetches.
export async function collectClassLinks(page, archive, { pages = 80, onLink } = {}) {
  const found = new Map();
  const handler = async (res) => {
    if (!/seesaw\.me/.test(res.url())) return;
    const body = await res.text().catch(() => '');
    if (!body) return;
    for (const url of extractGoogleUrls(body)) {
      if (found.has(url)) continue;
      found.set(url, true);
      if (onLink) onLink(url);
    }
  };

  page.on('response', handler);
  try {
    await page.goto(feedUrl(archive.personId, archive.classId), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // "Show More" pages the journal backwards. Scrolling alone stops at the
    // first page, which is how older years get silently missed.
    let idle = 0;
    for (let i = 0; i < pages && idle < 6; i += 1) {
      const more = page.getByRole('button', { name: /show more|load more/i }).first();
      if (await more.count().catch(() => 0)) {
        await more.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(2200);
        idle = 0;
      } else {
        await page.mouse.wheel(0, 2500);
        await page.waitForTimeout(900);
        idle += 1;
      }
    }
  } finally {
    page.off('response', handler);
  }

  return [...found.keys()].map((url) => {
    const g = googleId(url);
    return {
      url,
      kind: g ? g.kind : 'link',
      id: g ? g.id : '',
      child: archive.childName,
      className: archive.className,
    };
  });
}

export function dedupe(links) {
  const seen = new Map();
  for (const l of links) {
    const key = l.id || l.url;
    if (!seen.has(key)) seen.set(key, l);
  }
  return [...seen.values()];
}

export function toTsv(links) {
  return 'child\tclass\ttype\tgoogle_id\turl\n' + links
    .map((l) => [l.child, l.className, l.kind, l.id, l.url].join('\t'))
    .join('\n') + '\n';
}

// Single quotes, so a class name with $ or a backtick can't run anything.
function shellQuote(s) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function fetchScript(links) {
  const lines = [
    '#!/bin/bash',
    '# Fetch the Google content that Seesaw posts link to but the archive omits.',
    '# Needs rclone with a Google Drive remote named "gdrive":',
    '#   rclone config create gdrive drive scope=drive.readonly',
    '# Items you no longer have access to fail with 404; that is expected.',
    'set -u',
    '',
  ];
  for (const l of links) {
    if (!l.id || l.kind === 'form') continue;
    const dest = shellQuote(
      `Linked Content/${safeDirName(l.child) || 'Unknown'}/${safeDirName(l.className) || 'Unknown'}`);
    lines.push(`mkdir -p ${dest}`);
    lines.push(l.kind === 'folder'
      ? `rclone copy gdrive: ${dest} --drive-root-folder-id ${l.id}`
      : `rclone backend copyid gdrive: ${l.id} ${dest}/`);
  }
  return lines.join('\n') + '\n';
}
