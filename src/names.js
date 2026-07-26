export function sanitize(text) {
  return String(text || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 80);
}

// Seesaw class names usually carry the school year, in shapes like
// "Art PK4-A 2023-24" or "PK4-A 2025-26 The Hedgehogs". Some carry none.
export function schoolYear(className) {
  const m = String(className || '').match(/\b(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})\b/);
  if (!m) return null;
  const start = m[1];
  const end = m[2].length === 4 ? m[2].slice(2) : m[2];
  return `${start}-${end}`;
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
