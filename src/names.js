// Characters Windows refuses in file names, plus control characters.
const UNSAFE = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitize(text) {
  return String(text || '')
    .replace(UNSAFE, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 80)
    // Windows silently drops trailing dots, so "Mrs._B." would not round-trip.
    .replace(/[._]+$/, '');
}

// Like sanitize, but keeps spaces so folder names stay readable.
export function safeDirName(text) {
  return String(text || '').replace(UNSAFE, '_').replace(/[. ]+$/, '').trim();
}

// Seesaw class names usually carry the school year, in shapes like
// "Art PK4-A 2023-24" or "PK4-A 2025-26 The Hedgehogs". Some carry none.
export function schoolYear(className) {
  const name = String(className || '');

  const full = name.match(/\b(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})\b/);
  if (full) {
    const start = full[1];
    const end = full[2].length === 4 ? full[2].slice(2) : full[2];
    return `${start}-${end}`;
  }

  // Teachers also write it short, as in "PK4-A Library 23-24". Only accept
  // consecutive years, so a room or group number like "12-19" isn't mistaken
  // for one.
  const short = name.match(/\b(\d{2})\s*[-–/]\s*(\d{2})\b/);
  if (short && Number(short[2]) === Number(short[1]) + 1) {
    return `20${short[1]}-${short[2]}`;
  }

  return null;
}

// Accepts "2023-24", "2023-2024", or either single year on its own.
export function matchesYear(className, wanted) {
  const year = schoolYear(className);
  if (!year) return false;
  const needle = String(wanted).trim().replace(/\s+/g, '');
  if (!needle) return false;
  const [start, end] = year.split('-');
  return needle === year ||
    needle === `${start}-20${end}` ||
    needle === start ||
    needle === `20${end}`;
}

// A word typed at the menu prompt selects by child name or school year, so a
// parent can type "Ada" or "2024-25" instead of reading off numbers.
export function matchIndexes(archives, word) {
  const needle = String(word || '').trim().toLowerCase();
  if (!needle) return [];
  return archives
    .map((a, i) => (
      (a.childName || '').toLowerCase().includes(needle) || matchesYear(a.className, word)
        ? i
        : -1))
    .filter((i) => i >= 0);
}

export function childFolder(childName) {
  return sanitize(childName) || 'Unknown_Child';
}

// Child stays in the filename as well as the folder, so a zip still says what it
// is after someone drags it out of the folder.
export function archiveFilename({ childName, className }) {
  const parts = [sanitize(childName), sanitize(className)].filter(Boolean);
  const base = parts.join('_') || `Seesaw_Archive_${new Date().toISOString().split('T')[0]}`;
  return `${base}.zip`;
}
