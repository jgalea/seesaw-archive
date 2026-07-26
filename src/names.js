export function sanitize(text) {
  return String(text || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 80);
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
