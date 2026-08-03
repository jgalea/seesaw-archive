import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { schoolYear } from './names.js';

const require = createRequire(import.meta.url);

// Seesaw writes one HTML file per post. Anything a teacher linked to rather than
// uploaded (a Drive folder, a Slides deck) is only a URL in there, so the
// archive records that it existed without holding it.
const ATTR_URL = /(?:href|src)="(https?:\/\/[^"]+)"/gi;
const ANY_URL = /https?:\/\/[^\s"'<>)\]]+/gi;
const SEESAW_OWN = /^https?:\/\/(app\.|web\.)?seesaw\.me/i;

export function isGoogle(url) {
  return /^https?:\/\/(docs|drive)\.google\.com/i.test(url);
}

export function googleId(url) {
  const folder = url.match(/drive\/folders\/([A-Za-z0-9_-]+)/);
  if (folder) return { id: folder[1], kind: 'folder' };
  const file = url.match(/\/(document|presentation|spreadsheets|file)\/d\/([A-Za-z0-9_-]+)/);
  if (file) {
    const kinds = {
      document: 'doc', presentation: 'slides', spreadsheets: 'sheet', file: 'file',
    };
    return { id: file[2], kind: kinds[file[1]] };
  }
  return null;
}

export function extractUrls(html) {
  const attrs = new Set();
  for (const m of html.matchAll(ATTR_URL)) attrs.add(m[1]);
  const all = new Set(attrs);
  // Teachers often paste a URL as plain text rather than as a link, so matching
  // only href/src attributes misses them.
  for (const m of html.matchAll(ANY_URL)) all.add(m[0].replace(/[.,;]+$/, ''));
  return [...all].filter((u) => !SEESAW_OWN.test(u));
}

function readHtmlEntries(zipPath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    const out = [];
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('entry', (entry) => {
        if (!/\.html$/i.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            out.push({ name: entry.fileName, html: Buffer.concat(chunks).toString('utf8') });
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Walks the downloaded archives and reports what they point at but don't contain.
export async function scanArchives(outDir) {
  const found = [];
  let posts = 0;
  let archives = 0;

  const children = (await fs.readdir(outDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory());

  for (const child of children) {
    const dir = path.join(outDir, child.name);
    const zips = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.zip'));
    for (const zipName of zips) {
      archives += 1;
      const entries = await readHtmlEntries(path.join(dir, zipName));
      posts += entries.length;
      for (const { name, html } of entries) {
        const postFile = name.split('/').pop();
        for (const url of extractUrls(html)) {
          const g = googleId(url);
          found.push({
            child: child.name,
            className: zipName.replace(/\.zip$/i, '').replace(`${child.name}_`, ''),
            year: schoolYear(zipName) || '',
            postDate: postFile.slice(0, 10),
            url,
            google: Boolean(g),
            kind: g ? g.kind : 'link',
            id: g ? g.id : '',
          });
        }
      }
    }
  }
  return { archives, posts, links: found };
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
  const head = 'child\tclass\tpost_date\ttype\tgoogle_id\turl\n';
  return head + links
    .map((l) => [l.child, l.className, l.postDate, l.kind, l.id, l.url].join('\t'))
    .join('\n') + '\n';
}
