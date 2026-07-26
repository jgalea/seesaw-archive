import fs from 'node:fs/promises';
import path from 'node:path';
import { childFolder, archiveFilename } from './names.js';
import { clickDownload, waitForAlert } from './archives.js';

// Seesaw only reveals that a class has nothing archived after you ask for it.
export const EMPTY_NOTICE = /no items to download|nothing to download|no items yet/i;

const MANIFEST_NAME = '.seesaw-archive.json';

export async function loadManifest(outDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(outDir, MANIFEST_NAME), 'utf8'));
  } catch {
    return { downloads: {} };
  }
}

export async function saveManifest(outDir, manifest) {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
}

export function manifestKey(archive) {
  return archive.classId || `${archive.childName}::${archive.className}`;
}

function classIdFromUrl(url) {
  const m = String(url || '').match(/[?&]cl=(class\.[0-9a-fA-F-]+)/);
  return m ? m[1] : null;
}

// One archive at a time, and each one waits for its own download to finish.
// Seesaw builds the zip server-side after the click and only then redirects to
// archive.seesaw.me, so overlapping clicks make it cancel downloads or fall back
// to emailing the link instead.
export async function downloadArchive(page, archive, { outDir, timeout = 900000 }) {
  const dir = path.join(outDir, childFolder(archive.childName));
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, archiveFilename(archive));

  const pending = page.waitForEvent('download', { timeout });
  // If the click fails or the browser closes first, this promise still settles
  // later. Without a handler it surfaces as an unhandled rejection and takes
  // the whole process down after the run has already reported its results.
  pending.catch(() => {});

  await clickDownload(page, archive.index);

  // A click is answered either by a file eventually arriving, or by an alert
  // saying the class is empty. Waiting only for the download means an empty
  // class stalls for the whole timeout.
  const outcome = await Promise.race([
    pending.then((d) => ({ download: d })),
    waitForAlert(page, timeout).then((text) => ({ alertText: text })),
  ]);

  if (outcome.alertText) {
    if (EMPTY_NOTICE.test(outcome.alertText)) {
      return { empty: true, message: outcome.alertText };
    }
    // Any other notice is Seesaw talking about progress, so keep waiting.
  }

  const download = outcome.download || await pending;
  await download.saveAs(dest);

  const { size } = await fs.stat(dest);
  const urlClassId = classIdFromUrl(download.url());

  return {
    dest,
    bytes: size,
    url: download.url(),
    suggestedFilename: download.suggestedFilename(),
    // Seesaw's download URL carries cl=class.<id>, so the saved file can be
    // checked against the row it came from rather than assumed correct.
    classIdMatches: urlClassId ? urlClassId === archive.classId : null,
  };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
