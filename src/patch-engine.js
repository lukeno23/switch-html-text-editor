/*
 * patch-engine.js — byte-preserving text editing for HTML documents.
 *
 * The contract: editing text must change ONLY the bytes of the text runs the
 * user actually touched. Everything else in the file — attribute order, quote
 * style, indentation, comments, base64 blobs, the FONTS-START/FONTS-END markers
 * the Switch build scripts depend on — must come out byte-identical.
 *
 * We therefore never serialize a DOM. Instead:
 *   1. scanDocument() walks the raw source and records the [start,end) offsets
 *      of every text run, grouped by the element that directly contains it.
 *   2. instrument() adds a single data-hep="N" attribute to the open tag of
 *      each element that holds editable text. Attributes only — no structural
 *      change — so layout is unaffected.
 *   3. The browser renders the instrumented copy. data-hep maps each rendered
 *      element back to its source element, and editable runs are matched
 *      within that element by ordinal, then verified by text equality.
 *   4. applyEdits() splices new text into the ORIGINAL source at the recorded
 *      offsets, working back-to-front so earlier offsets stay valid.
 *
 * No dependencies. Runs unchanged in Node and the browser.
 */

// Elements whose content is raw text, not markup. We skip their interiors
// entirely — this is what keeps the 78KB base64 font line out of scope.
const RAW_TEXT_TAGS = new Set(['script', 'style']);

// Elements whose text is never offered for editing.
const NON_EDITABLE_PARENTS = new Set(['script', 'style', 'title', 'textarea', 'option']);

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', copy: '©',
  reg: '®', trade: '™', deg: '°', laquo: '«',
  raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', bull: '•', middot: '·', times: '×',
  euro: '€', pound: '£', shy: '­', ensp: ' ',
  emsp: ' ', thinsp: ' ',
};

export function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
      try { return String.fromCodePoint(cp); } catch { return whole; }
    }
    const hit = NAMED_ENTITIES[body];
    return hit === undefined ? whole : hit;
  });
}

/*
 * Encode text for insertion into markup. Only the three characters that would
 * change parsing are escaped, plus NBSP — left as a literal U+00A0 it is
 * invisible in a diff and indistinguishable from a space, so we keep it named.
 * Deliberately minimal: over-escaping would rewrite text the user never typed.
 */
export function encodeText(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&nbsp;');
}

// Find the '>' that closes the tag starting at `start`, ignoring '>' that
// appears inside a quoted attribute value.
function findTagEnd(src, start) {
  let quote = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function isWhitespaceOnly(s) {
  return /^[\s ]*$/.test(s);
}

/*
 * Walk the source and build a flat list of elements, each carrying the text
 * runs that are its DIRECT children. Returns { elements, runs, editable }.
 *
 * This is a scanner, not a spec-compliant parser: it does not model implicit
 * tag closing or foster parenting. That is fine, because element identity is
 * later confirmed against the real DOM via data-hep, and every matched run is
 * verified by text equality before it is made editable. Anything the scanner
 * gets wrong shows up as a verification miss and is simply not editable —
 * it can never cause a bad write.
 */
export function scanDocument(src) {
  const elements = [];
  const runs = [];

  const root = {
    id: 0, tag: '#document', parentId: null,
    openTagStart: -1, openTagEnd: -1, selfClosing: false,
    inHead: false, inSvg: false, textRuns: [],
  };
  elements.push(root);

  const stack = [root];
  const top = () => stack[stack.length - 1];

  let i = 0;

  const pushText = (start, end) => {
    if (end <= start) return;
    const raw = src.slice(start, end);
    const parent = top();
    const run = {
      index: runs.length,
      start, end, raw,
      text: decodeEntities(raw),
      wsOnly: isWhitespaceOnly(raw),
      elementId: parent.id,
      parentTag: parent.tag,
      inHead: parent.inHead,
      inSvg: parent.inSvg,
    };
    runs.push(run);
    parent.textRuns.push(run);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      pushText(i, src.length);
      break;
    }
    if (lt > i) pushText(i, lt);

    // Comment
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    // DOCTYPE / CDATA / other bogus-comment forms
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const m = /^<(\/?)([a-zA-Z][^\s/>]*)/.exec(src.slice(lt, lt + 128));
    if (!m) {
      // A bare '<' that isn't a tag. Treat as text so offsets stay contiguous.
      pushText(lt, lt + 1);
      i = lt + 1;
      continue;
    }

    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const gt = findTagEnd(src, lt);
    if (gt === -1) {
      pushText(lt, src.length);
      break;
    }

    if (isClose) {
      // Unwind to the matching open tag if we have one; ignore strays.
      for (let d = stack.length - 1; d >= 1; d--) {
        if (stack[d].tag === tag) {
          stack.length = d;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = src[gt - 1] === '/';
    const parent = top();
    const el = {
      id: elements.length,
      tag,
      parentId: parent.id,
      openTagStart: lt,
      openTagEnd: gt,
      selfClosing,
      inHead: parent.inHead || tag === 'head',
      inSvg: parent.inSvg || tag === 'svg',
      textRuns: [],
    };
    elements.push(el);

    // Raw-text elements: jump straight past their contents.
    if (RAW_TEXT_TAGS.has(tag) && !selfClosing) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = src.slice(gt + 1);
      const cm = closeRe.exec(rest);
      i = cm ? gt + 1 + cm.index + cm[0].length : src.length;
      continue;
    }

    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(el);
    i = gt + 1;
  }

  // An editable run: real text, visible in the preview, in a normal container.
  const editable = runs.filter((r) =>
    !r.wsOnly && !r.inHead && !r.inSvg && !NON_EDITABLE_PARENTS.has(r.parentTag)
  );

  // Ordinal of each editable run among its element's editable runs. This is the
  // key the browser uses to match a DOM text node back to its source offsets.
  const perElement = new Map();
  for (const r of editable) {
    const n = perElement.get(r.elementId) || 0;
    r.editableOrdinal = n;
    perElement.set(r.elementId, n + 1);
  }

  return { elements, runs, editable, source: src };
}

/*
 * Return a copy of the source with data-hep="<elementId>" added to the open tag
 * of every element that directly contains editable text. Attribute-only, so no
 * layout or selector behaviour changes (verified: the Switch template uses no
 * attribute selectors).
 */
export function instrument(scan, attr = 'data-hep') {
  const { source, editable } = scan;
  const ids = [...new Set(editable.map((r) => r.elementId))];
  const targets = ids
    .map((id) => scan.elements[id])
    .filter((el) => el && el.openTagStart >= 0)
    .sort((a, b) => b.openTagStart - a.openTagStart); // back-to-front

  let out = source;
  for (const el of targets) {
    // Insert before the closing '>' — or before the '/' of a self-closing tag.
    const at = el.selfClosing ? el.openTagEnd - 1 : el.openTagEnd;
    out = `${out.slice(0, at)} ${attr}="${el.id}"${out.slice(at)}`;
  }
  return out;
}

/*
 * Apply edits to the original source.
 *
 * edits: [{ index, text }] where `index` is a run index from scan.runs and
 * `text` is the new DECODED text (what the user sees and types).
 *
 * Runs whose text is unchanged are dropped, so an untouched document is
 * returned byte-for-byte identical. Overlapping edits are rejected rather than
 * silently resolved.
 */
export function applyEdits(scan, edits) {
  const { source, runs } = scan;

  const real = [];
  for (const e of edits) {
    const run = runs[e.index];
    if (!run) throw new Error(`applyEdits: no run at index ${e.index}`);
    const encoded = encodeText(e.text);
    if (encoded === run.raw) continue; // no-op: never rewrite untouched bytes
    real.push({ run, encoded });
  }

  if (real.length === 0) return { html: source, changed: 0 };

  real.sort((a, b) => a.run.start - b.run.start);
  for (let k = 1; k < real.length; k++) {
    if (real[k].run.start < real[k - 1].run.end) {
      throw new Error('applyEdits: overlapping edits');
    }
  }

  let out = '';
  let cursor = 0;
  for (const { run, encoded } of real) {
    out += source.slice(cursor, run.start) + encoded;
    cursor = run.end;
  }
  out += source.slice(cursor);

  return { html: out, changed: real.length };
}

/* ------------------------------------------------------------- review block */

/*
 * Review comments live in ONE marker-delimited HTML comment placed immediately
 * before </body>.
 *
 * This is the single deliberate exception to "only edited text runs are ever
 * written". It is safe because the block sits outside every text run, HTML
 * comments do not render so the PDF is unaffected, and scanDocument() skips
 * comments so the block can never become editable text. It follows the same
 * pattern make-selfcontained.py uses for its FONTS-START/FONTS-END markers.
 */

const REVIEW_RE =
  /\n?<!--\s*SWITCH-REVIEW-START\s*\r?\n([\s\S]*?)\r?\n\s*SWITCH-REVIEW-END\s*-->[ \t]*\n?/;

/*
 * A literal '-->' inside the JSON would close the comment early, so any hyphen
 * that could begin '--' or '->' is written as a JSON \u002d escape. JSON.parse
 * turns those back into ordinary hyphens, so note text round-trips exactly.
 */
function escapeForComment(json) {
  return json.replace(/-(?=[->])/g, '\\u002d');
}

export function readReview(src) {
  const m = REVIEW_RE.exec(src);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // A block we can't parse is ignored, never guessed at.
  }
}

export function hasReview(src) {
  return REVIEW_RE.test(src);
}

/*
 * Return `src` with its review block replaced by `comments` — or removed
 * entirely when `comments` is empty, so clearing every comment restores the
 * file byte-for-byte.
 */
export function writeReview(src, comments) {
  const stripped = src.replace(REVIEW_RE, '\n');
  if (!comments || comments.length === 0) return stripped;

  const json = escapeForComment(JSON.stringify(comments, null, 1));
  const block = `<!-- SWITCH-REVIEW-START\n${json}\nSWITCH-REVIEW-END -->\n`;

  const at = stripped.lastIndexOf('</body>');
  if (at === -1) return stripped + (stripped.endsWith('\n') ? '' : '\n') + block;
  return stripped.slice(0, at) + block + stripped.slice(at);
}
