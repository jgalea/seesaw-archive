import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schoolYear, matchesYear, archiveFilename, childFolder, matchIndexes,
} from '../src/names.js';
import { parseSelection } from '../src/prompt.js';
import { EMPTY_NOTICE } from '../src/download.js';
import {
  extractGoogleUrls, googleId, isGoogle, cleanUrl, feedUrl, fetchScript,
} from '../src/links.js';

test('URLs are recovered from escaped JSON payloads', () => {
  // Link targets arrive inside API responses, not as clean HTML attributes.
  const payload = '{"itemType":"link","url":"https:\\/\\/drive.google.com\\/drive\\/folders\\/ABC123?usp=sharing","caption":"All the pictures here!"}';
  assert.deepEqual(extractGoogleUrls(payload),
    ['https://drive.google.com/drive/folders/ABC123?usp=sharing']);
});

test('quotes and trailing punctuation are stripped', () => {
  assert.equal(cleanUrl('https://drive.google.com/drive/folders/ABC123"'),
    'https://drive.google.com/drive/folders/ABC123');
  assert.equal(cleanUrl('https://drive.google.com/drive/folders/ABC123.'),
    'https://drive.google.com/drive/folders/ABC123');
});

test('the feed route is built from the class and person ids', () => {
  assert.equal(feedUrl('person.abc', 'class.def'),
    'https://app.seesaw.me/#/family/journals/person.abc/class.def');
});

test('Google links are classified by what they point at', () => {
  assert.deepEqual(googleId('https://drive.google.com/drive/folders/ABC123'),
    { id: 'ABC123', kind: 'folder' });
  assert.deepEqual(googleId('https://docs.google.com/presentation/d/XYZ789/edit?usp=drive_web'),
    { id: 'XYZ789', kind: 'slides' });
  assert.deepEqual(googleId('https://drive.google.com/file/d/F1LE/view'),
    { id: 'F1LE', kind: 'file' });
  assert.deepEqual(googleId('https://docs.google.com/forms/d/e/1FAI_form/viewform'),
    { id: '1FAI_form', kind: 'form' });
  assert.equal(googleId('https://example.com/'), null);
  assert.equal(isGoogle('https://issuu.com/x/docs/y'), false);
});

test('the empty-class notice is recognised from what Seesaw actually says', () => {
  assert.ok(EMPTY_NOTICE.test('There are no items to download yet for Ada Ross! OK'));
  assert.ok(EMPTY_NOTICE.test('Nothing to download'));
  assert.equal(EMPTY_NOTICE.test('Your download is being prepared'), false);
  assert.equal(EMPTY_NOTICE.test("We'll email you a link when it's ready"), false);
});

test('schoolYear pulls the year out of a class name', () => {
  assert.equal(schoolYear('Art PK4-A 2023-24'), '2023-24');
  assert.equal(schoolYear('PK4-A 2025-26 The Hedgehogs'), '2025-26');
  assert.equal(schoolYear('Homeroom 2024-2025'), '2024-25');
  assert.equal(schoolYear('1A Lenguas y sociales con Ms Silvia'), null);
  // Seen on a real account: teachers write the short form too.
  assert.equal(schoolYear('PK4-A Library 23-24'), '2023-24');
  // Non-consecutive pairs are room or group numbers, not school years.
  assert.equal(schoolYear('Reading Group 12-19'), null);
  assert.equal(schoolYear('Homeroom 1-A'), null);
});

test('matchesYear accepts the shapes a parent would type', () => {
  for (const needle of ['2023-24', '2023-2024', '2023', '2024']) {
    assert.equal(matchesYear('Art PK4-A 2023-24', needle), true, needle);
  }
  assert.equal(matchesYear('Art PK4-A 2023-24', '2025-26'), false);
  assert.equal(matchesYear('Class with no year', '2023'), false);
});

test('filenames keep the child and stay filesystem-safe', () => {
  assert.equal(
    archiveFilename({ childName: 'Ada Ross', className: 'Gross Motor PK4-A 2023-24' }),
    'Ada_Ross_Gross_Motor_PK4-A_2023-24.zip'
  );
  assert.equal(
    archiveFilename({ childName: 'Ada Ross', className: 'Art / Music' }),
    'Ada_Ross_Art_Music.zip'
  );
  assert.equal(childFolder(''), 'Unknown_Child');
});

test('typing a child name or year at the menu selects the right rows', () => {
  const rows = [
    { childName: 'Ada Ross', className: 'Art PK4-A 2023-24' },
    { childName: 'Ada Ross', className: 'Music K5-A 2024-25' },
    { childName: 'Sam Ross', className: 'Art PK3-A 2024-25' },
  ];
  assert.deepEqual(matchIndexes(rows, 'Ada'), [0, 1]);
  assert.deepEqual(matchIndexes(rows, 'ada'), [0, 1]);
  assert.deepEqual(matchIndexes(rows, '2024-25'), [1, 2]);
  assert.deepEqual(matchIndexes(rows, 'Ross'), [0, 1, 2]);
  assert.deepEqual(matchIndexes(rows, 'nobody'), []);
});

test('parseSelection handles numbers, ranges, all, and words', () => {
  assert.deepEqual(parseSelection('1-3,7', 10), [0, 1, 2, 6]);
  assert.deepEqual(parseSelection('all', 3), [0, 1, 2]);
  assert.deepEqual(parseSelection('', 3), []);
  assert.deepEqual(parseSelection('2,2,1', 3), [0, 1]);
  assert.deepEqual(parseSelection('ada', 3, () => [1, 2]), [1, 2]);
  assert.throws(() => parseSelection('9', 3), /Out of range/);
  assert.throws(() => parseSelection('3-1', 5), /Out of range/);
  assert.throws(() => parseSelection('nope', 3, () => []), /Nothing matches/);
});

test('file names are valid on Windows too', () => {
  assert.equal(archiveFilename({ childName: 'Ada', className: 'Year 1: Mrs. B.' }),
    'Ada_Year_1_Mrs._B.zip');
  assert.equal(childFolder('Tab\there'), 'Tab_here');
});

test('the fetch script quotes class names so the shell never expands them', () => {
  const script = fetchScript([{
    child: 'Ada', className: `Art "$(rm -rf ~)" it's done.`, kind: 'folder', id: 'ABC123',
  }]);
  assert.ok(script.includes(`mkdir -p 'Linked Content/Ada/Art _$(rm -rf ~)_ it'\\''s done'`));
  assert.ok(script.includes('--drive-root-folder-id ABC123'));
});
