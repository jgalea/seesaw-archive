import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

async function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    // Ctrl+D or a closed stdin rejects here; treat it as "cancel" rather than
    // letting it surface as a crash.
    const answer = await rl.question(question).catch(() => '');
    return String(answer ?? '').trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question) {
  const answer = await ask(`${question} [y/N] `);
  return /^y(es)?$/i.test(answer);
}

// Accepts "1-3,7,9", "all", an empty string for cancel, and any other word as a
// name or year to match (so a parent can type a child's name or "2024-25"
// instead of hunting for numbers). Returns zero-based indexes into the list
// that was shown.
export function parseSelection(input, max, matchWord) {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (/^all$/i.test(trimmed)) return Array.from({ length: max }, (_, i) => i);

  const picked = new Set();
  for (const part of trimmed.split(',')) {
    const chunk = part.trim();
    if (!chunk) continue;

    const range = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > max || from > to) throw new Error(`Out of range: ${chunk}`);
      for (let n = from; n <= to; n += 1) picked.add(n - 1);
      continue;
    }

    if (/^\d+$/.test(chunk)) {
      const n = Number(chunk);
      if (n < 1 || n > max) throw new Error(`Out of range: ${chunk}`);
      picked.add(n - 1);
      continue;
    }

    const matched = matchWord ? matchWord(chunk) : [];
    if (!matched.length) throw new Error(`Nothing matches "${chunk}"`);
    matched.forEach((i) => picked.add(i));
  }
  return [...picked].sort((a, b) => a - b);
}

export async function pickArchives(archives, { formatLine, groupOf, matchWord }) {
  console.log('');
  let lastGroup = null;
  archives.forEach((archive, i) => {
    const group = groupOf ? groupOf(archive) : null;
    if (group && group !== lastGroup) {
      console.log(`\n  ${group}`);
      lastGroup = group;
    }
    console.log(`   ${String(i + 1).padStart(3)}. ${formatLine(archive)}`);
  });
  console.log('\n  Pick by number (1-3,7), by child or year (Ada, 2024-25), or "all".');

  const answer = await ask('  Which ones? (empty to cancel): ');
  const indexes = parseSelection(answer, archives.length, matchWord);
  return indexes.map((i) => archives[i]);
}
