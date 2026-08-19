import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  scanDocument, instrument, applyEdits, decodeEntities, encodeText,
} from '../src/patch-engine.js';

/* ------------------------------------------------------------------ helpers */

// Every run must be re-derivable from the source at its recorded offsets, and
// runs must never overlap or run backwards.
function assertOffsetsSound(scan) {
  let prevEnd = 0;
  for (const r of scan.runs) {
    assert.equal(scan.source.slice(r.start, r.end), r.raw, `run ${r.index} raw mismatch`);
    assert.ok(r.start >= prevEnd, `run ${r.index} overlaps previous`);
    assert.ok(r.end > r.start, `run ${r.index} is empty`);
    prevEnd = r.end;
  }
}

// Setting every run back to its own current text must be a total no-op.
function assertNoOpIsByteIdentical(scan) {
  const edits = scan.runs.map((r) => ({ index: r.index, text: r.text }));
  const { html, changed } = applyEdits(scan, edits);
  assert.equal(changed, 0, 'no-op edits should collapse to zero changes');
  assert.equal(html, scan.source, 'no-op must return byte-identical source');
}

/* ------------------------------------------------------------- entity codec */

test('entity decode handles named, decimal and hex forms', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('caf&#233;'), 'café');
  assert.equal(decodeEntities('caf&#xE9;'), 'café');
  assert.equal(decodeEntities('a&nbsp;b'), 'a b');
  assert.equal(decodeEntities('no entities here'), 'no entities here');
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
});

test('encode escapes only what changes parsing, and keeps NBSP named', () => {
  assert.equal(encodeText('a & b'), 'a &amp; b');
  assert.equal(encodeText('<b>'), '&lt;b&gt;');
  assert.equal(encodeText('a b'), 'a&nbsp;b');
  assert.equal(encodeText("quotes ' and \" survive"), "quotes ' and \" survive");
});

test('decode/encode round-trips the entities we emit', () => {
  for (const raw of ['a &amp; b', '&lt;x&gt;', 'a&nbsp;b', 'plain text']) {
    assert.equal(encodeText(decodeEntities(raw)), raw);
  }
});

/* -------------------------------------------------------- scanner behaviour */

test('scanner skips script and style interiors entirely', () => {
  const src = [
    '<html><head><style>p { content: "<not a tag>"; }</style></head>',
    '<body><script>var a = 1 < 2; document.write("<p>nope</p>");</script>',
    '<p>real text</p></body></html>',
  ].join('');
  const scan = scanDocument(src);
  assertOffsetsSound(scan);

  const editableText = scan.editable.map((r) => r.text);
  assert.deepEqual(editableText, ['real text']);
  for (const r of scan.runs) {
    assert.ok(!r.raw.includes('content:'), 'style interior leaked into a run');
    assert.ok(!r.raw.includes('document.write'), 'script interior leaked into a run');
  }
});

test("scanner is not fooled by '>' inside an attribute value", () => {
  const src = '<p title="a > b" data-x=\'c > d\'>text</p>';
  const scan = scanDocument(src);
  assertOffsetsSound(scan);
  assert.deepEqual(scan.editable.map((r) => r.text), ['text']);
});

test('scanner skips comments, doctype, head and svg content', () => {
  const src = [
    '<!DOCTYPE html><html><head><title>Title</title></head><body>',
    '<!-- a comment with <p>markup</p> inside -->',
    '<svg><text>logo text</text></svg>',
    '<p>editable</p></body></html>',
  ].join('');
  const scan = scanDocument(src);
  assertOffsetsSound(scan);
  assert.deepEqual(scan.editable.map((r) => r.text), ['editable']);
});

test('whitespace-only runs are tracked but never editable', () => {
  const scan = scanDocument('<div>\n  <p>hi</p>\n</div>');
  assertOffsetsSound(scan);
  assert.ok(scan.runs.some((r) => r.wsOnly), 'expected whitespace runs to exist');
  assert.deepEqual(scan.editable.map((r) => r.text), ['hi']);
});

test('editable ordinals are per-element, not global', () => {
  const scan = scanDocument('<p>one <b>bold</b> two</p><p>three</p>');
  const byEl = new Map();
  for (const r of scan.editable) {
    if (!byEl.has(r.elementId)) byEl.set(r.elementId, []);
    byEl.get(r.elementId).push([r.text, r.editableOrdinal]);
  }
  // First <p> directly owns "one " and " two"; "bold" belongs to <b>.
  const firstP = [...byEl.values()].find((v) => v.some(([t]) => t === 'one '));
  assert.deepEqual(firstP, [['one ', 0], [' two', 1]]);
  const bold = [...byEl.values()].find((v) => v.some(([t]) => t === 'bold'));
  assert.deepEqual(bold, [['bold', 0]]);
});

/* --------------------------------------------------------- instrumentation */

test('instrument adds only attributes, and only to elements holding text', () => {
  const src = '<div><section><p>hi</p></section></div>';
  const scan = scanDocument(src);
  const out = instrument(scan);

  // Exactly one element (<p>) directly contains editable text.
  const hits = [...out.matchAll(/ data-hep="\d+"/g)];
  assert.equal(hits.length, 1);
  assert.match(out, /<p data-hep="\d+">hi<\/p>/);

  // Stripping the injected attributes must restore the original byte-for-byte.
  assert.equal(out.replace(/ data-hep="\d+"/g, ''), src);
});

test('instrument places the attribute before the slash of a self-closing tag', () => {
  const scan = scanDocument('<div><p>hi</p><br/></div>');
  const out = instrument(scan);
  assert.ok(!out.includes('/ data-hep'), 'attribute must not land after the slash');
  assert.equal(out.replace(/ data-hep="\d+"/g, ''), '<div><p>hi</p><br/></div>');
});

/* ------------------------------------------------------------ edit application */

test('a single edit changes only that run', () => {
  const src = '<p>alpha</p><p>beta</p><p>gamma</p>';
  const scan = scanDocument(src);
  const beta = scan.editable.find((r) => r.text === 'beta');

  const { html, changed } = applyEdits(scan, [{ index: beta.index, text: 'BETA REWRITTEN' }]);
  assert.equal(changed, 1);
  assert.equal(html, '<p>alpha</p><p>BETA REWRITTEN</p><p>gamma</p>');
});

test('edits are encoded on the way in', () => {
  const scan = scanDocument('<p>plain</p>');
  const run = scan.editable[0];
  const { html } = applyEdits(scan, [{ index: run.index, text: 'Tom & Jerry <ok>' }]);
  assert.equal(html, '<p>Tom &amp; Jerry &lt;ok&gt;</p>');
});

test('multiple edits apply independently and keep surrounding bytes intact', () => {
  const src = '<h1>Title</h1>\n<p>first</p>\n<p>second</p>';
  const scan = scanDocument(src);
  const pick = (t) => scan.editable.find((r) => r.text === t).index;
  const { html, changed } = applyEdits(scan, [
    { index: pick('second'), text: '2nd' },
    { index: pick('Title'), text: 'New Title' },
  ]);
  assert.equal(changed, 2);
  assert.equal(html, '<h1>New Title</h1>\n<p>first</p>\n<p>2nd</p>');
});

test('unchanged runs are dropped even when submitted alongside real edits', () => {
  const scan = scanDocument('<p>keep</p><p>change</p>');
  const keep = scan.editable.find((r) => r.text === 'keep');
  const change = scan.editable.find((r) => r.text === 'change');
  const { html, changed } = applyEdits(scan, [
    { index: keep.index, text: 'keep' },
    { index: change.index, text: 'changed' },
  ]);
  assert.equal(changed, 1);
  assert.equal(html, '<p>keep</p><p>changed</p>');
});

test('overlapping edits are rejected rather than silently merged', () => {
  const scan = scanDocument('<p>text</p>');
  const run = scan.editable[0];
  const fake = { index: run.index, text: 'a' };
  // Fabricate a second run that overlaps the first to prove the guard fires.
  scan.runs.push({ ...run, index: scan.runs.length, start: run.start, end: run.end });
  assert.throws(
    () => applyEdits(scan, [fake, { index: scan.runs.length - 1, text: 'b' }]),
    /overlapping edits/,
  );
});

test('an unknown run index is an error, not a silent skip', () => {
  const scan = scanDocument('<p>text</p>');
  assert.throws(() => applyEdits(scan, [{ index: 9999, text: 'x' }]), /no run at index/);
});

/* --------------------------------------------- the real Switch white paper */

/*
 * Round-trip tests against a real production document. Point HEP_FIXTURE at a
 * self-contained Switch HTML file, or drop one in test/fixtures/, and these run;
 * otherwise they skip. Real documents are never committed — see .gitignore.
 *
 *   HEP_FIXTURE="/path/to/document.html" npm test
 */
const REAL_FILE = process.env.HEP_FIXTURE
  || new URL('./fixtures/document.html', import.meta.url).pathname;

test('real document: scan, no-op and surgical edit', { skip: !existsSync(REAL_FILE) && 'no fixture — set HEP_FIXTURE' }, () => {
  const src = readFileSync(REAL_FILE, 'utf8');
  const scan = scanDocument(src);

  assertOffsetsSound(scan);
  assertNoOpIsByteIdentical(scan);

  // Sanity: the document has real prose, and the embedded fonts are untouched.
  // Enough to prove the scanner engaged, without assuming a document length —
  // a 13-slide deck has ~108 runs where a 22-page paper has ~371.
  assert.ok(scan.editable.length > 40, `expected real prose, got ${scan.editable.length} runs`);
  for (const r of scan.runs) {
    assert.ok(!r.raw.includes('data:font/woff2'), 'a font blob leaked into a text run');
    assert.ok(!r.raw.includes('@font-face'), 'CSS leaked into a text run');
  }

  // Instrumentation must be attribute-only whatever the document is, and any
  // build markers the document happens to carry must survive it. Only documents
  // produced by make-selfcontained.py have those markers, so assert on what this
  // document actually contains rather than assuming a Switch template.
  const inst = instrument(scan);
  for (const marker of ['===FONTS-START===', '===FONTS-END===']) {
    if (src.includes(marker)) assert.ok(inst.includes(marker), `${marker} lost`);
  }
  assert.equal(inst.replace(/ data-hep="\d+"/g, ''), src, 'instrumentation was not attribute-only');

  // Edit one run and prove the diff is exactly one contiguous region.
  const target = scan.editable.find((r) => r.text.trim().length > 25);
  const replacement = 'REPLACEMENT SENTINEL TEXT';
  const { html, changed } = applyEdits(scan, [{ index: target.index, text: replacement }]);
  assert.equal(changed, 1);

  assert.equal(html.slice(0, target.start), src.slice(0, target.start), 'bytes before the edit moved');
  assert.equal(html.slice(target.start + replacement.length), src.slice(target.end), 'bytes after the edit moved');
  assert.equal(html.length, src.length - target.raw.length + replacement.length);
});

test('real document: encoding is lossless in meaning for every editable run', { skip: !existsSync(REAL_FILE) && 'no fixture — set HEP_FIXTURE' }, () => {
  const src = readFileSync(REAL_FILE, 'utf8');
  const scan = scanDocument(src);

  /*
   * The property that matters is that a round-trip preserves the TEXT, not the
   * entity spelling. A source may use `&middot;`, which we decode to `·` and
   * would re-emit as a literal `·` — same character, different bytes. Editing
   * such a run therefore changes its entity spelling, which is allowed; leaving
   * it alone must not, which is what the no-op test above proves.
   */
  const lossy = scan.editable.filter((r) => decodeEntities(encodeText(r.text)) !== r.text);
  assert.deepEqual(
    lossy.map((r) => ({ index: r.index, raw: r.raw.slice(0, 60) })),
    [],
    'these runs would come back as different text after an edit',
  );
});

test('an unchanged run is never rewritten, even when its entity spelling differs', () => {
  // `&middot;` decodes to `·`, which encodeText emits literally. Submitting the
  // decoded text unchanged must still be treated as a no-op.
  const src = '<p>Footer &middot; Document name</p><p>plain</p>';
  const scan = scanDocument(src);
  const run = scan.editable.find((r) => r.text.includes('·'));
  assert.notEqual(encodeText(run.text), run.raw, 'precondition: spelling differs');

  const noop = applyEdits(scan, [{ index: run.index, text: run.text }]);
  assert.equal(noop.changed, 0);
  assert.equal(noop.html, src, 'an untouched entity run must not be rewritten');

  // A genuine edit to that run is allowed to change the spelling, but only there.
  const edited = applyEdits(scan, [{ index: run.index, text: 'Footer · Renamed document' }]);
  assert.equal(edited.changed, 1);
  assert.equal(edited.html, '<p>Footer · Renamed document</p><p>plain</p>');
});

test('invisible characters are written as entities, not bare literals', () => {
  assert.equal(encodeText('a\u00a0b'), 'a&nbsp;b');
  assert.equal(encodeText('a\u00adb'), 'a&shy;b');
  assert.equal(encodeText('a\u2009b'), 'a&thinsp;b');
  // Visible characters stay literal — re-encoding them would rewrite user text.
  assert.equal(encodeText('a·b'), 'a·b');
  assert.equal(encodeText('a—b'), 'a—b');
});

/* --------------------------------------------------------------- review block */

import { readReview, writeReview, hasReview } from '../src/patch-engine.js';

const DOC = '<!DOCTYPE html><html><head><title>T</title></head><body>\n<p>Text here</p>\n</body></html>';

test('a document with no review block reads as no comments', () => {
  assert.equal(hasReview(DOC), false);
  assert.deepEqual(readReview(DOC), []);
});

test('review comments round-trip through the block', () => {
  const comments = [
    { id: 1, page: 3, quote: 'Fix comms', note: 'too terse, expand this' },
    { id: 2, page: 7, quote: 'anyone can.', note: 'is this defensible?' },
  ];
  const out = writeReview(DOC, comments);
  assert.ok(hasReview(out));
  assert.deepEqual(readReview(out), comments);
});

test('the block sits before </body> and never inside a text run', () => {
  const out = writeReview(DOC, [{ id: 1, quote: 'x', note: 'y' }]);
  assert.ok(out.indexOf('SWITCH-REVIEW-START') < out.lastIndexOf('</body>'));

  const scan = scanDocument(out);
  assert.ok(!scan.runs.some((r) => r.raw.includes('SWITCH-REVIEW')), 'block leaked into a run');
  // The document's own editable text is untouched by the block's presence.
  assert.deepEqual(scan.editable.map((r) => r.text), ['Text here']);
});

test('clearing every comment restores the file byte-for-byte', () => {
  const withBlock = writeReview(DOC, [{ id: 1, quote: 'a', note: 'b' }]);
  assert.notEqual(withBlock, DOC);
  assert.equal(writeReview(withBlock, []), DOC);
});

test('rewriting the block replaces it rather than stacking copies', () => {
  let out = writeReview(DOC, [{ id: 1, quote: 'a', note: 'first' }]);
  out = writeReview(out, [{ id: 1, quote: 'a', note: 'second' }]);
  assert.equal(out.split('SWITCH-REVIEW-START').length - 1, 1);
  assert.equal(readReview(out)[0].note, 'second');
  assert.equal(writeReview(out, []), DOC);
});

test('notes containing -- or --> cannot break out of the comment', () => {
  const nasty = 'em--dash, an arrow -> here, and a real --> terminator';
  const out = writeReview(DOC, [{ id: 1, quote: 'q', note: nasty }]);

  // The dangerous sequence must not appear before the block's own terminator.
  const body = out.slice(out.indexOf('SWITCH-REVIEW-START'), out.indexOf('SWITCH-REVIEW-END'));
  assert.ok(!body.includes('-->'), 'raw --> survived inside the block');
  assert.ok(!body.includes('--'), 'raw -- survived inside the block');

  // ...and the note still comes back exactly as typed.
  assert.equal(readReview(out)[0].note, nasty);
  assert.equal(writeReview(out, []), DOC);
});

test('an unparseable block is ignored rather than guessed at', () => {
  const broken = DOC.replace('</body>', '<!-- SWITCH-REVIEW-START\n{not json\nSWITCH-REVIEW-END -->\n</body>');
  assert.deepEqual(readReview(broken), []);
});

test('edits and review comments compose without touching each other', () => {
  const scan = scanDocument(DOC);
  const run = scan.editable[0];
  const edited = applyEdits(scan, [{ index: run.index, text: 'Replaced text' }]);
  const withReview = writeReview(edited.html, [{ id: 1, quote: 'Replaced text', note: 'check' }]);

  assert.ok(withReview.includes('<p>Replaced text</p>'));
  assert.deepEqual(readReview(withReview)[0].note, 'check');
  // Stripping the block leaves exactly the edited document.
  assert.equal(writeReview(withReview, []), edited.html);
});

test('real document: review block leaves every run and all markup alone', { skip: !existsSync(REAL_FILE) && 'no fixture — set HEP_FIXTURE' }, () => {
  const src = readFileSync(REAL_FILE, 'utf8');
  const comments = [{ id: 1, page: 3, quote: 'Fix comms', note: 'expand -- properly' }];
  const out = writeReview(src, comments);

  const a = scanDocument(src);
  const b = scanDocument(out);
  assert.deepEqual(b.editable.map((r) => r.text), a.editable.map((r) => r.text));

  const markup = (s) => {
    let m = '', cur = 0;
    for (const r of s.runs) { m += s.source.slice(cur, r.start); cur = r.end; }
    return m + s.source.slice(cur);
  };
  // Everything outside the text runs is identical once the block is removed.
  assert.equal(markup(scanDocument(writeReview(out, []))), markup(a));
  assert.equal(writeReview(out, []), src, 'clearing comments must restore the original exactly');

  // Whatever the document carries outside its text runs must come through
  // untouched — build markers and embedded font blobs included, where present.
  for (const marker of ['===FONTS-START===', '===FONTS-END===']) {
    if (src.includes(marker)) assert.ok(out.includes(marker), `${marker} lost`);
  }
  const blobs = (s) => (s.match(/data:font\/woff2/g) || []).length;
  assert.equal(blobs(out), blobs(src), 'embedded font count changed');
  assert.deepEqual(readReview(out), comments);
});
