# Export to Word and PowerPoint (editor): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Export to Word / Export to PowerPoint" button to the editor. It turns a fixed-page document into a .docx, or a deck into a .pptx. The output looks as close to the HTML and PDF as the destination allows, with the brand fonts embedded, and it imports cleanly into Google Docs and Google Slides.

**Architecture:**
- A brand-agnostic exporter made of plain classic scripts in `src/export/`. It runs inside a rendered document.
  - `extract.js` measures the DOM and builds a JSON layout model.
  - `fonts.js` reads the document's own fonts.
  - `docx.js` and `pptx.js` turn the model into files.
  - `index.js` orchestrates.
- Third-party libraries are pinned in `vendor/` and loaded only on first export.
- The editor exports the bytes Save would write, rendered in a fresh offscreen iframe, never the live editing frame.

**Tech Stack:**
- vanilla JS as classic scripts with one global `window.HepExport`, and no build step;
- `docx` 9.7.1, `pptxgenjs` 4.0.1, `jszip` 3.10.2, `woff2-encoder` 2.0.0 (decompress only);
- Node's built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-23-office-export-design.md`. Read it first. This plan argues from it.

**Reference code:** the spike in `.spike/office-export/`. It is local only, ignored through `.git/info/exclude`, and has a `README.md` of findings. Its files are the proven starting point for `extract.js`, `docx.js`, `pptx.js` and `fonts.js`. Where this plan and the spike differ, the plan wins: it carries the fixes found in Google Docs testing.

## What comes after this plan

The user wants a quick turnaround, so this is plan 1 of 3:

1. **This plan:** export in the editor, for fixed-page documents and decks.
2. **Flowing documents** (`pagination: 'flow'`), written next.
   - The model carries `pagination`.
   - `walk()`, `paragraph()` and `tableOf()` are page-agnostic.
   - `docx.js` emits explicit page breaks only when `pagination === 'fixed'`.
   - So flowing documents add a new page-assembly function and a single-section builder path, and rework nothing.
3. **Skill integration and one v1.5 release of both skills**, covering both export modes at once.

## Global Constraints

These apply to every task.

**Repo rules**
- **The repo is public.** No client names, no second-brand name, and none of its typeface names, anywhere: code, tests, fixtures, commit messages. Before every commit run `git diff --cached | grep -niE "<the private name list in CLAUDE.md house rules and project memory>"`. It must print nothing. Test fixtures use the Switch templates with invented content only.
- **No build step.** Files load as they are, from `index.html` in the browser, from Playwright in the skills, and from `vm` in Node tests.
- **`vendor/` is the only third-party code.** It is pinned, loaded only when the user exports, and served from this repo, never a CDN.

**The existing invariants (`CLAUDE.md` 1–7) stand, plus a new one:**
- **Invariant 8:** export never writes the HTML file and never reads the live editing frame. It reads only a fresh render of the bytes Save would produce.

**Word output**
- **Line spacing is always proportional** (`w:lineRule="auto"`). Google Docs misreads exact spacing, so a `.docx` must never contain `w:lineRule="exact"`.
- **All inter-block space goes on space-before.** Space-after is used only on the last block in a container.
- **Tab stops are measured from the text column's left edge.**
- **Embed all four font slots per family.** Faces whose `fsType` forbids editable embedding are not embedded; that produces a warning.

**The editor**
- **Style:** match the surrounding code, in comment density, naming (`camelCase`, `$('id')`), British English in UI copy, and consequence-first comments.
- **Every push gets a `CHANGELOG.md` entry.** Commit freely, but push only with Luke's explicit OK, because pushing to `main` deploys.
- **Browser testing traps (from `CLAUDE.md`):**
  - reload between `__hep.load()` calls, and check `state().fileName`;
  - load `index.html?v=N` after each edit;
  - front the tab before measuring, because a background tab has a zero-size viewport.

---

## File structure

| Path | Status | Responsibility |
|---|---|---|
| `vendor/docx.iife.js`, `vendor/pptxgen.bundle.js`, `vendor/jszip.min.js`, `vendor/woff2-decompress.js` | new | Pinned libraries, copied byte for byte from npm |
| `vendor/VERSIONS.md`, `vendor/licenses/*` | new | Version, source, SHA-256 and licence for each file |
| `src/export/fonts.js` | new | sfnt reader, cmap, `@font-face` collection, face mapping, genre, embeddability, `.odttf`, EOT, family rename |
| `src/export/extract.js` | new | `detectKind(doc)` and `extract(doc)`, which turns the rendered DOM into the layout model |
| `src/export/docx.js` | new | `toDocx(model, fonts, deps)`, returning `{ bytes, faces }` |
| `src/export/pptx.js` | new | `toPptx(model, fonts, deps)`, returning `{ bytes, faces }` |
| `src/export/index.js` | new | `run(doc, deps)`: detect, extract, collect fonts, build, and warn |
| `test/export/load.mjs` | new | Loads vendor files and `src/export/*.js` into Node exactly as the browser would |
| `test/export/*.test.mjs` | new | Unit tests |
| `test/fixtures/export-doc.html`, `test/fixtures/export-deck.html` | new | Template-derived fixtures with invented content; fonts by relative URL to `assets/fonts/` |
| `test/fixtures/export-harness.html` | new | Browser harness: loads a fixture, returns its model and export |
| `index.html` | modify | Export button, vendor loader, `buildHtml()` refactor, offscreen render, save picker, warnings, `__hep.export*` |
| `package.json` | modify | Test glob |
| `.gitignore` | modify | Add `*.pptx` |
| `CLAUDE.md`, `README.md`, `SNAGS.md`, `CHANGELOG.md` | modify | Invariant 8, an "Exporting" section, findings, entries |
| `.spike/office-export/export_via_harness.py` | new, local only | Runs the harness in Playwright and writes a .docx/.pptx to disk, for Word and PowerPoint checks |

---

### Task 1: Vendor the libraries and make them loadable in Node

**Files:**
- Create: `vendor/docx.iife.js`, `vendor/pptxgen.bundle.js`, `vendor/jszip.min.js`, `vendor/woff2-decompress.js`, `vendor/VERSIONS.md`, `vendor/licenses/`
- Create: `test/export/load.mjs`, `test/export/vendor.test.mjs`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: `test/export/load.mjs` exports:
  - `ROOT` (string, the repo root with a trailing `/`);
  - `libs` (`{ docx, PptxGenJS, JSZip }`);
  - `HepExport` (the global, after `src/export/*.js` has loaded);
  - `decompress(bytes: Uint8Array) → Promise<Uint8Array>`;
  - `bundledFonts() → Promise<FontInfo[]>`, available once Task 2 exists.
- `src/export/*.js` are loaded if they exist, in this order: `fonts`, `extract`, `docx`, `pptx`, `index`.

- [ ] **Step 1: Copy the pinned files from the spike's `node_modules`**

```bash
cd "/Users/lukeazzopardi/Claude Code/HTML Editor"
S=.spike/office-export/node_modules
mkdir -p vendor/licenses
cp $S/docx/dist/index.iife.js vendor/docx.iife.js
cp $S/pptxgenjs/dist/pptxgen.bundle.js vendor/pptxgen.bundle.js
cp $S/jszip/dist/jszip.min.js vendor/jszip.min.js
cp $S/woff2-encoder/dist/decompress.js vendor/woff2-decompress.js
cp $S/docx/LICENSE vendor/licenses/docx.txt
cp $S/pptxgenjs/LICENSE vendor/licenses/pptxgenjs.txt
cp $S/jszip/LICENSE.markdown vendor/licenses/jszip.md
cp $S/woff2-encoder/LICENSE vendor/licenses/woff2-encoder.txt
```

- [ ] **Step 2: Write `vendor/VERSIONS.md` with real hashes**

```bash
cd "/Users/lukeazzopardi/Claude Code/HTML Editor"
h() { shasum -a 256 "vendor/$1" | cut -d' ' -f1; }
cat > vendor/VERSIONS.md <<EOF
# Vendored libraries

Loaded only when someone exports to Word or PowerPoint. Pinned: the export
post-processes these libraries' exact XML, so an upgrade must re-run the fidelity
checks in CLAUDE.md "Exporting" before it ships.

| File | Package | Version | Source in the npm package | Licence | SHA-256 |
|---|---|---|---|---|---|
| docx.iife.js | docx | 9.7.1 | dist/index.iife.js | MIT | $(h docx.iife.js) |
| pptxgen.bundle.js | pptxgenjs | 4.0.1 | dist/pptxgen.bundle.js (includes JSZip) | MIT | $(h pptxgen.bundle.js) |
| jszip.min.js | jszip | 3.10.2 | dist/jszip.min.js | MIT or GPL-3.0 (used under MIT) | $(h jszip.min.js) |
| woff2-decompress.js | woff2-encoder | 2.0.0 | dist/decompress.js (ES module, WebAssembly inline) | MIT | $(h woff2-decompress.js) |
EOF
cat vendor/VERSIONS.md
```

Expected: four rows, each with a 64-hex-character hash.

- [ ] **Step 3: Write the failing test `test/export/vendor.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT, libs, decompress } from './load.mjs';

test('vendored libraries load as classic scripts on one global', () => {
  assert.equal(typeof libs.docx.Document, 'function');
  assert.equal(typeof libs.PptxGenJS, 'function');
  assert.equal(typeof libs.JSZip, 'function');
});

test("the WOFF2 decoder turns the editor's bundled fonts back into TrueType", async () => {
  const ttf = await decompress(new Uint8Array(readFileSync(ROOT + 'assets/fonts/DMSans-400.woff2')));
  assert.equal(new DataView(ttf.buffer, ttf.byteOffset).getUint32(0), 0x00010000);
});

test('pptxgenjs can write a deck under Node', async () => {
  const p = new libs.PptxGenJS();
  p.addSlide().addText('x', { x: 1, y: 1, w: 1, h: 1 });
  const bytes = await p.write({ outputType: 'uint8array' });
  assert.ok(bytes.length > 1000);
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `node --test test/export/vendor.test.mjs`
Expected: FAIL, `Cannot find module .../test/export/load.mjs`.

- [ ] **Step 5: Write `test/export/load.mjs`**

```js
/*
 * Loads the export code exactly as a browser page does: classic scripts sharing one
 * global. Tests therefore exercise the shipped files, not a Node-specific build.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
globalThis.window = globalThis;

for (const f of [
  'vendor/jszip.min.js', 'vendor/docx.iife.js', 'vendor/pptxgen.bundle.js',
  'src/export/fonts.js', 'src/export/extract.js', 'src/export/docx.js', 'src/export/pptx.js', 'src/export/index.js',
]) {
  if (existsSync(ROOT + f)) vm.runInThisContext(readFileSync(ROOT + f, 'utf8'), { filename: f });
}

export const libs = { docx: globalThis.docx, PptxGenJS: globalThis.PptxGenJS, JSZip: globalThis.JSZip };
export const HepExport = globalThis.HepExport;
export const decompress = (await import(pathToFileURL(ROOT + 'vendor/woff2-decompress.js').href)).default;

// The editor's seven bundled faces, as a document would declare them. Needs fonts.js (Task 2).
const FACES = [
  ['DM Sans', 400, false, 'DMSans-400'], ['DM Sans', 400, true, 'DMSans-400i'], ['DM Sans', 500, false, 'DMSans-500'],
  ['DM Sans', 600, false, 'DMSans-600'], ['DM Sans', 700, false, 'DMSans-700'],
  ['Source Serif 4', 400, false, 'SourceSerif4-400'], ['Source Serif 4', 600, false, 'SourceSerif4-600'],
];
export function bundledCss() {
  return FACES.map(([fam, w, it, file]) => {
    const b64 = readFileSync(`${ROOT}assets/fonts/${file}.woff2`).toString('base64');
    return `@font-face { font-family: '${fam}'; font-style: ${it ? 'italic' : 'normal'}; font-weight: ${w}; src: url(data:font/woff2;base64,${b64}) format('woff2'); }`;
  });
}
export async function bundledFonts() {
  const { fonts } = await HepExport.fonts.fromCss(bundledCss(), { decompress, fetchBytes: async () => { throw new Error('no network in tests'); } });
  return fonts;
}
```

- [ ] **Step 6: Update `package.json` and `.gitignore`**

In `package.json`, set the test script to run every test file:

```json
    "test": "node --test \"test/**/*.test.mjs\""
```

In `.gitignore`, add below `*.docx`:

```
*.pptx
```

- [ ] **Step 7: Run all tests and confirm they pass**

Run: `npm test`
Expected: the 38 existing tests plus 3 new ones pass (the four real-document tests still skip).

If the pptxgenjs test fails with a DOM reference such as `document is not defined`, add `globalThis.navigator ??= { userAgent: 'node' };` in `load.mjs` before the loop and re-run. Do not switch to a Node-only build.

- [ ] **Step 8: Commit**

```bash
git add vendor test/export/load.mjs test/export/vendor.test.mjs package.json .gitignore
git commit -m "Vendor the Word and PowerPoint libraries, loadable in Node as in the browser"
```

---

### Task 2: `fonts.js`, the document's own fonts, ready for Office

**Files:**
- Create: `src/export/fonts.js`
- Test: `test/export/fonts.test.mjs`

**Interfaces:**
- **Produces:** `HepExport.fonts` with the functions below.
  - `readFont(bytes: Uint8Array) → FontInfo`
  - `parseFontFaces(css: string) → { family, weight, italic, urls[] }[]`
  - `fromCss(cssTexts: string[], { fetchBytes(url) → Promise<ArrayBuffer>, decompress }) → Promise<{ fonts: FontInfo[], warnings: string[] }>`
  - `collect(doc, deps)` → the same, read from `doc.styleSheets`.
  - `faceMapper(fonts) → (family, weight, italic) → { face, bold, italics, font: FontInfo|null }`
  - `lineRatio(font: FontInfo|null) → number`: (winAscent + winDescent) / unitsPerEm, or 1.2.
  - `genre(font) → 'swiss'|'roman'|'script'`
  - `embeddable(font) → boolean`
  - `officeFamilies(fonts, usedFaces: Set<string>) → { name, panose, genre, slots: { regular?, bold?, italic?, boldItalic? } }[]`
  - `odttf(bytes, guid?) → { data: Uint8Array, key: '{GUID}' }`
  - `eot(font) → Uint8Array`
  - `base64ToBytes(s) → Uint8Array`
- **`FontInfo` fields:**
  - identity: `bytes`, `names` (id to string), `family` (nameID 1), `sub`, `typoFamily`;
  - style: `weight`, `italic`, `bold`, `fsType`, `familyClass`, `panose[10]`;
  - coverage: `uni[4]`, `codePage[2]`, `cmap` (a `Set` of code points);
  - metrics: `checkSumAdj`, `upm`, `winAscent`, `winDescent`;
  - how CSS declared it: `cssFamily`, `cssWeight`, `cssItalic`.

- [ ] **Step 1: Write the failing tests `test/export/fonts.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT, HepExport, decompress, bundledCss, bundledFonts } from './load.mjs';

const F = () => HepExport.fonts;
const ttf = async (file) => decompress(new Uint8Array(readFileSync(`${ROOT}assets/fonts/${file}.woff2`)));

test('reads family, weight, permissions and coverage from a font', async () => {
  const f = F().readFont(await ttf('DMSans-400'));
  assert.equal(f.family, 'DM Sans');
  assert.equal(f.weight, 400);
  assert.equal(f.fsType, 0);
  assert.ok(f.cmap.has(0x41) && f.cmap.has(0x2192), 'has A and the → arrow');
  assert.ok(f.upm > 0 && f.winAscent > 0);
});

test('an intermediate weight is a family of its own in Office terms', async () => {
  const f = F().readFont(await ttf('DMSans-600'));
  assert.equal(f.family, 'DM Sans SemiBold');
  assert.equal(f.typoFamily, 'DM Sans');
  assert.equal(f.bold, false);
});

test('fromCss decodes data URLs, skips sources it cannot reach, and lets later rules win', async () => {
  const css = bundledCss();
  const broken = "@font-face { font-family: 'DM Sans'; font-weight: 400; src: url('../fonts/missing.ttf'); }";
  const bold = css.find((c) => /weight: 700/.test(c)).replace('font-weight: 700', 'font-weight: 400');
  const { fonts } = await F().fromCss([broken, css[0].replace('italic', 'normal'), bold],
    { decompress, fetchBytes: async () => { throw new Error('offline'); } });
  assert.equal(fonts.length, 1, 'one face for DM Sans 400 normal');
  assert.equal(fonts[0].bold, true, 'the later rule (the bold file) won');
});

test('maps CSS weights to Office faces and slots', async () => {
  const map = F().faceMapper(await bundledFonts());
  assert.deepEqual((({ face, bold }) => ({ face, bold }))(map('DM Sans', 600, false)), { face: 'DM Sans SemiBold', bold: false });
  assert.deepEqual((({ face, bold }) => ({ face, bold }))(map('DM Sans', 700, false)), { face: 'DM Sans', bold: true });
  assert.equal(map('DM Sans', 400, true).italics, true);
  assert.equal(map('Unknown Face', 700, false).font, null);
});

test('groups faces into Office families with four slots', async () => {
  const fams = F().officeFamilies(await bundledFonts(), new Set(['DM Sans', 'DM Sans SemiBold']));
  const dm = fams.find((f) => f.name === 'DM Sans');
  assert.deepEqual(Object.keys(dm.slots).sort(), ['bold', 'italic', 'regular']);
  assert.equal(dm.genre, 'swiss');
  assert.ok(fams.find((f) => f.name === 'DM Sans SemiBold').slots.regular);
  assert.equal(fams.length, 2, 'unused families are left out');
});

test('refuses to embed restricted and preview-only faces', () => {
  const e = F().embeddable;
  assert.equal(e({ fsType: 0 }), true);
  assert.equal(e({ fsType: 8 }), true);
  assert.equal(e({ fsType: 2 }), false);
  assert.equal(e({ fsType: 4 }), false);
  assert.equal(e({ fsType: 0x200 }), false);
});

test('odttf obfuscation is its own inverse and touches only the first 32 bytes', async () => {
  const bytes = await ttf('DMSans-400');
  const guid = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';
  const once = F().odttf(bytes, guid);
  assert.equal(once.key, `{${guid}}`);
  assert.notDeepEqual(once.data.subarray(0, 32), bytes.subarray(0, 32));
  assert.deepEqual(once.data.subarray(32), bytes.subarray(32));
  assert.deepEqual(F().odttf(once.data, guid).data, bytes);
});

test('EOT header carries the font as LibreOffice writes it', async () => {
  const f = F().readFont(await ttf('DMSans-700'));
  const e = F().eot(f);
  const dv = new DataView(e.buffer, e.byteOffset);
  assert.equal(dv.getUint32(0, true), e.length, 'EOTSize');
  assert.equal(dv.getUint32(4, true), f.bytes.length, 'FontDataSize');
  assert.equal(dv.getUint32(8, true), 0x00020002, 'Version');
  assert.equal(dv.getUint16(34, true), 0x504C, 'MagicNumber');
  assert.equal(dv.getUint32(28, true), 700, 'Weight');
  assert.deepEqual(e.subarray(e.length - f.bytes.length), f.bytes, 'font data at the end, uncompressed');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/export/fonts.test.mjs`
Expected: FAIL, `Cannot read properties of undefined (reading 'fonts')`.

- [ ] **Step 3: Write `src/export/fonts.js`**

```js
/*
 * Fonts for export. Every face comes from the document's own @font-face rules (or the
 * editor's lent substitute for a broken one), never from a list of brands, so one
 * exporter serves any design system. DOM-free except collect(), so Node can test it.
 *
 * Office thinks in families with four slots (regular, bold, italic, bold italic).
 * A Medium or SemiBold file is therefore a family of its own ("DM Sans SemiBold"),
 * which is exactly how its name table describes it.
 */
(function (root) {
  'use strict';
  const X = (root.HepExport ||= {});

  function base64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Code points the font maps. Format 4's ranges can include a few unmapped codes;
  // that only matters for glyph routing, which checks coverage loosely anyway.
  function readCmap(dv, base) {
    const out = new Set();
    let best = null;
    for (let i = 0, n = dv.getUint16(base + 2); i < n; i++) {
      const pid = dv.getUint16(base + 4 + 8 * i), eid = dv.getUint16(base + 6 + 8 * i), off = dv.getUint32(base + 8 + 8 * i);
      const fmt = dv.getUint16(base + off);
      if (pid === 3 && eid === 10 && fmt === 12) { best = { off, fmt }; break; }
      if (pid === 3 && eid === 1 && fmt === 4) best = { off, fmt };
    }
    if (!best) return out;
    const s = base + best.off;
    if (best.fmt === 12) {
      for (let g = 0, n = dv.getUint32(s + 12); g < n; g++) {
        for (let c = dv.getUint32(s + 16 + 12 * g), e = dv.getUint32(s + 20 + 12 * g); c <= e; c++) out.add(c);
      }
    } else {
      const segX2 = dv.getUint16(s + 6), ends = s + 14, starts = ends + segX2 + 2;
      for (let k = 0; k < segX2; k += 2) {
        const st = dv.getUint16(starts + k), e = dv.getUint16(ends + k);
        if (st !== 0xFFFF) for (let c = st; c <= e; c++) out.add(c);
      }
    }
    return out;
  }

  function readFont(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const t = {};
    for (let i = 0, n = dv.getUint16(4); i < n; i++) {
      const o = 12 + 16 * i;
      t[String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
    }
    for (const need of ['OS/2', 'head', 'name', 'cmap']) if (!t[need]) throw new Error(`font has no ${need} table`);
    const os2 = t['OS/2'].off, head = t.head.off, name = t.name.off;
    const names = {};
    const strOff = name + dv.getUint16(name + 4);
    for (let i = 0, n = dv.getUint16(name + 2); i < n; i++) {
      const o = name + 6 + 12 * i;
      if (dv.getUint16(o) !== 3 || dv.getUint16(o + 2) !== 1 || dv.getUint16(o + 4) !== 0x409) continue;
      const nid = dv.getUint16(o + 6), len = dv.getUint16(o + 8), off = dv.getUint16(o + 10);
      if (names[nid] !== undefined) continue;
      let s = '';
      for (let k = 0; k < len; k += 2) s += String.fromCharCode(dv.getUint16(strOff + off + k));
      names[nid] = s;
    }
    const fsSelection = dv.getUint16(os2 + 62);
    return {
      bytes, names, family: names[1], sub: names[2], typoFamily: names[16] || names[1],
      weight: dv.getUint16(os2 + 4), fsType: dv.getUint16(os2 + 8), familyClass: dv.getInt16(os2 + 30) >> 8,
      panose: Array.from(bytes.subarray(os2 + 32, os2 + 42)),
      uni: [0, 1, 2, 3].map((k) => dv.getUint32(os2 + 42 + 4 * k)),
      codePage: dv.getUint16(os2) >= 1 ? [dv.getUint32(os2 + 78), dv.getUint32(os2 + 82)] : [0, 0],
      italic: !!(fsSelection & 1), bold: !!(fsSelection & 32),
      checkSumAdj: dv.getUint32(head + 8), upm: dv.getUint16(head + 18),
      winAscent: dv.getUint16(os2 + 74), winDescent: dv.getUint16(os2 + 76),
      cmap: readCmap(dv, t.cmap.off),
    };
  }

  function parseFontFaces(css) {
    const out = [];
    for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const b = m[1];
      const family = (b.match(/font-family\s*:\s*(['"]?)([^;'"]+)\1/) || [])[2];
      if (!family) continue;
      const w = (b.match(/font-weight\s*:\s*(\d+|bold|normal)/) || [])[1] || '400';
      out.push({
        family: family.trim(),
        weight: w === 'bold' ? 700 : w === 'normal' ? 400 : +w,
        italic: /font-style\s*:\s*(italic|oblique)/.test(b),
        urls: [...b.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((u) => u[2]),
      });
    }
    return out;
  }

  const isWoff2 = (b) => b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x32;
  const isWoff1 = (b) => b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x46;

  // Later rules win, as in CSS: the editor appends its lent substitutes after the
  // document's own (broken) rules, so a substitute replaces the face it stands in for.
  async function fromCss(cssTexts, { fetchBytes, decompress }) {
    const byKey = new Map(), warnings = [];
    for (const face of cssTexts.flatMap(parseFontFaces)) {
      const key = `${face.family.toLowerCase()}|${face.weight}|${face.italic}`;
      for (const url of face.urls) {
        try {
          let bytes = url.startsWith('data:') ? base64ToBytes(url.slice(url.indexOf(',') + 1)) : new Uint8Array(await fetchBytes(url));
          if (isWoff1(bytes)) { warnings.push(`${face.family} ${face.weight}: WOFF (version 1) fonts can't be embedded.`); continue; }
          if (isWoff2(bytes)) bytes = await decompress(bytes);
          byKey.set(key, { ...readFont(bytes), cssFamily: face.family, cssWeight: face.weight, cssItalic: face.italic });
          break;
        } catch { /* unreachable or unreadable source: try the next one */ }
      }
    }
    return { fonts: [...byKey.values()], warnings };
  }

  async function collect(doc, deps) {
    const css = [];
    for (const sheet of doc.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) if (r.type === 5 /* CSSRule.FONT_FACE_RULE */) css.push(r.cssText);
    }
    return fromCss(css, deps);
  }

  function faceMapper(fonts) {
    return (family, weight, italic) => {
      const cands = fonts.filter((f) => f.cssFamily.toLowerCase() === String(family).toLowerCase());
      if (!cands.length) return { face: family, bold: weight >= 600, italics: italic, font: null };
      let best = cands[0], score = Infinity;
      for (const f of cands) {
        const s = Math.abs(f.cssWeight - weight) + (f.cssItalic !== italic ? 1000 : 0);
        if (s < score) { score = s; best = f; }
      }
      return { face: best.family, bold: best.bold, italics: best.italic || (italic && !best.cssItalic), font: best };
    };
  }

  const lineRatio = (f) => (f && f.upm ? (f.winAscent + f.winDescent) / f.upm : 1.2);

  // Word's substitution hint for when a face is missing: OS/2 class, else PANOSE, else sans.
  function genre(f) {
    if (f.familyClass === 8) return 'swiss';
    if (f.familyClass >= 1 && f.familyClass <= 7) return 'roman';
    if (f.familyClass === 10) return 'script';
    if (f.panose[0] === 2 && f.panose[1] >= 2 && f.panose[1] <= 10) return 'roman';
    return 'swiss';
  }

  function embeddable(f) {
    if (f.fsType & 0x0200) return false;          // bitmap embedding only
    const lic = f.fsType & 0x000F;
    return lic !== 0x0002 && lic !== 0x0004;      // restricted; preview & print (would open read-only)
  }

  function officeFamilies(fonts, used) {
    const fams = new Map();
    for (const f of fonts) {
      if ((used && !used.has(f.family)) || !embeddable(f)) continue;
      const slot = f.bold && f.italic ? 'boldItalic' : f.bold ? 'bold' : f.italic ? 'italic' : 'regular';
      if (!fams.has(f.family)) fams.set(f.family, { name: f.family, panose: f.panose, genre: genre(f), slots: {} });
      fams.get(f.family).slots[slot] ||= f;
    }
    return [...fams.values()];
  }

  // DOCX: XOR the first 32 bytes with the reversed GUID (ECMA-376 Part 1 §17.8.1).
  function odttf(bytes, guid = root.crypto.randomUUID().toUpperCase()) {
    const key = guid.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16)).reverse();
    const data = Uint8Array.from(bytes);
    for (let i = 0; i < 32; i++) data[i] ^= key[i % 16];
    return { data, key: `{${guid}}` };
  }

  // PPTX: uncompressed Embedded OpenType, ported from LibreOffice vcl/source/font/EOTConverter.cxx.
  function eot(f) {
    const nameBytes = (s) => {
      if (s == null) return [0, 0, 0, 0];
      const b = [0, 0], len = s.length * 2 + 2;
      b.push(len & 255, len >> 8);
      for (const ch of s) { const c = ch.charCodeAt(0); b.push(c & 255, c >> 8); }
      b.push(0, 0);
      return b;
    };
    const tail = [
      ...nameBytes(f.names[1]), ...nameBytes(f.names[2]), ...nameBytes(f.names[5]), ...nameBytes(f.names[4]),
      0, 0, 0, 0, 0x42, 0x53, 0x47, 0x50, 0xE4, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const H = 80, total = H + tail.length + f.bytes.length;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, total, true); dv.setUint32(4, f.bytes.length, true);
    dv.setUint32(8, 0x00020002, true); dv.setUint32(12, 0, true);
    out.set(f.panose, 16); out[26] = 0; out[27] = f.italic ? 1 : 0;
    dv.setUint32(28, f.weight, true); dv.setUint16(32, f.fsType, true); dv.setUint16(34, 0x504C, true);
    f.uni.forEach((u, i) => dv.setUint32(36 + 4 * i, u, true));
    dv.setUint32(52, f.codePage[0], true); dv.setUint32(56, f.codePage[1], true);
    dv.setUint32(60, f.checkSumAdj, true);
    out.set(tail, H);
    out.set(f.bytes, H + tail.length);
    return out;
  }

  X.fonts = { readFont, parseFontFaces, fromCss, collect, faceMapper, lineRatio, genre, embeddable, officeFamilies, odttf, eot, base64ToBytes };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/export/fonts.test.mjs`
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/export/fonts.js test/export/fonts.test.mjs
git commit -m "Read a document's own fonts and prepare them for Word and PowerPoint embedding"
```

---

### Task 3: `extract.js`, the rendered DOM turned into the layout model

**Files:**
- Create: `src/export/extract.js`
- Create: `test/fixtures/export-doc.html`, `test/fixtures/export-deck.html`, `test/fixtures/export-harness.html`

**Interfaces:**
- **Produces:**
  - `HepExport.detectKind(doc) → { kind: 'document'|'deck', cards: Element[] } | { kind: 'unsupported', reason: string }`
  - `HepExport.extract(doc) → Promise<Model>`. It may mutate `doc`, for example by revealing every slide, so always pass a disposable render.
- **`Model`:**
  - Top level: `{ version: 1, kind, pagination: 'fixed', lang, title, warnings: string[] }`.
  - Documents add `base: Run` and `pages: Page[]`; decks add `slides: Slide[]`.
- **`Page`:**
  - size and margins: `widthMM`, `heightMM`, `margins { top, left, right, bottom }` (mm, one decimal);
  - `flattened: boolean`;
  - content: `blocks: Block[]`;
  - furniture: `header` and `footer`, each `{ distMM, rows: Row[] } | null`;
  - `layer: string|null` (a PNG data URL).
- **`Block`** is one of three:
  - **`p`:** `{ t: 'p', tag, runs, bullet, align, lineHeightPt, spaceBeforePt, spaceAfterPt, indentLeftPt, indentRightPt, hangingPt, noWrap, tabs? }`
  - **`table`:** `{ t: 'table', kind: 'table'|'columns'|'box', rows: [{ header?, cells: Cell[] }], indentLeftPt, widthPt, spaceBeforePt, spaceAfterPt }`
  - **`image`:** `{ t: 'image', png, wPt, hPt, indentLeftPt, spaceBeforePt, spaceAfterPt }`
- **`Cell`:** `{ widthPt, span, fill, pad { t, r, b, l }, borders { top, right, bottom, left }, valign, spacer?, blocks }`
- **`Run`** is one of four:
  - text: `{ text, family, weight, italic, sizePt, color, spacingPt, upper }`
  - `{ br: true }`
  - `{ tab: true, …style }`
  - `{ field: 'PAGE', …style }`
- **`Row`:** `{ cells: [{ widthPt, align, indentPt?, runs? | image? { png, wPt, hPt } }] }`
- **`Slide`:** `{ bg, wPt, hPt, items: [{ t: 'shape', shape, radiusPt, fill, alpha, shadow, x, y, w, h } | { t: 'image', png, x, y, w, h } | { t: 'text', x, y, w, h, paras: Block[] }] }`, all in pt.

- [ ] **Step 1: Create the two fixtures from the spike's, with fonts by relative URL**

The spike's fixtures embed the fonts as base64. The committed copies reference `assets/fonts/` instead. That keeps them small, and it exercises the fetch path the editor's lent fonts use.

```bash
cd "/Users/lukeazzopardi/Claude Code/HTML Editor"
node - <<'EOF'
const fs = require('fs');
const faces = [['DM Sans','italic',400,'DMSans-400i'],['DM Sans','normal',400,'DMSans-400'],['DM Sans','normal',500,'DMSans-500'],
  ['DM Sans','normal',600,'DMSans-600'],['DM Sans','normal',700,'DMSans-700'],['Source Serif 4','normal',400,'SourceSerif4-400'],['Source Serif 4','normal',600,'SourceSerif4-600']];
const block = '/* ===FONTS-START=== */\n' + faces.map(([f,s,w,file]) =>
  `@font-face { font-family: '${f}'; font-style: ${s}; font-weight: ${w}; src: url('../../assets/fonts/${file}.woff2') format('woff2'); }`).join('\n') + '\n/* ===FONTS-END=== */';
for (const [from, to] of [['export-trial-document','export-doc'],['export-trial-deck','export-deck']]) {
  let s = fs.readFileSync(`.spike/office-export/fixtures/${from}.html`, 'utf8');
  s = s.replace(/\/\* ===FONTS-START===[\s\S]*?===FONTS-END=== \*\//, block);
  fs.writeFileSync(`test/fixtures/${to}.html`, s);
  console.log(to, s.length, 'bytes', /base64/.test(s) ? 'STILL HAS BASE64' : 'ok');
}
EOF
```

Expected: `export-doc … ok` and `export-deck … ok`, each under 60,000 bytes.

- [ ] **Step 2: Create `test/fixtures/export-harness.html`**

```html
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>Export harness</title>
<!-- Test page: loads a fixture in a real-size offscreen frame and exports it with the shipped files. -->
<script src="../../vendor/jszip.min.js"></script>
<script src="../../vendor/docx.iife.js"></script>
<script src="../../vendor/pptxgen.bundle.js"></script>
<script src="../../src/export/fonts.js"></script>
<script src="../../src/export/extract.js"></script>
<script src="../../src/export/docx.js"></script>
<script src="../../src/export/pptx.js"></script>
<script src="../../src/export/index.js"></script>
</head>
<body>
<iframe id="f" style="position:absolute;left:-20000px;top:0;width:1600px;height:1000px;border:0"></iframe>
<script type="module">
import decompress from '../../vendor/woff2-decompress.js';
const f = document.getElementById('f');
function open(url) {
  return new Promise((resolve, reject) => {
    f.onload = async () => {
      try {
        const doc = f.contentDocument;
        await doc.fonts.ready;
        await new Promise((r) => setTimeout(r, 150));   // the templates number pages after fonts load
        resolve(doc);
      } catch (e) { reject(e); }
    };
    f.src = url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
  });
}
const deps = (doc) => ({
  docx: window.docx, PptxGenJS: window.PptxGenJS, JSZip: window.JSZip, decompress,
  fetchBytes: (u) => fetch(new URL(u, doc.baseURI)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${u}`); return r.arrayBuffer(); }),
});
window.extractFixture = async (url) => HepExport.extract(await open(url));
window.exportFixture = async (url) => { const doc = await open(url); return HepExport.run(doc, deps(doc)); };
window.toBase64 = async (bytes) => {
  const b = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([bytes])); });
  return b.slice(b.indexOf(',') + 1);
};
window.ready = true;
</script>
</body>
</html>
```

- [ ] **Step 3: Write `src/export/extract.js`**

```js
/*
 * Layout extraction for export (spec: docs/superpowers/specs/2026-09-23-office-export-design.md).
 *
 * Runs inside a rendered document — the editor's offscreen export frame, or a skill's
 * Playwright page — and returns a plain JSON model: text runs with resolved fonts and
 * colours, spacing measured from real geometry, decoration rasterised to PNG. It reads
 * the DOM and never fetches. It knows only the conventions both design systems share
 * (.page / .page-body, .slide / .slide-body): no brand names, no brand class names.
 *
 * `pagination: 'fixed'` is the only mode so far. Flowing documents reuse walk(),
 * paragraph() and tableOf() unchanged; only the page assembly differs.
 *
 * extract() may change the document it measures (it reveals every slide), so it must
 * only ever be handed a disposable render.
 */
(function (root) {
  'use strict';
  const X = (root.HepExport ||= {});
  const PT = 0.75;              // CSS px -> pt
  const MM = 25.4 / 96;         // CSS px -> mm
  const px = (v) => parseFloat(v) || 0;
  const round = (v, d = 2) => +v.toFixed(d);

  // Keep in step with looksLikeCards() in index.html, which answers the same question for the UI.
  function looksLikeCards(doc, els, bodySelector) {
    if (doc.querySelector(bodySelector)) return true;
    if (els.length < 2) return false;
    return doc.defaultView.getComputedStyle(els[0]).overflow === 'hidden';
  }

  X.detectKind = function detectKind(doc) {
    const slides = [...doc.querySelectorAll('.slide')];
    if (slides.length && looksLikeCards(doc, slides, '.slide-body')) return { kind: 'deck', cards: slides };
    const pages = [...doc.querySelectorAll('.page')];
    if (pages.length && looksLikeCards(doc, pages, '.page-body')) return { kind: 'document', cards: pages };
    return { kind: 'unsupported',
      reason: "This document flows like a web page instead of sitting on fixed pages, and export for flowing documents isn't available yet." };
  };

  X.extract = async function extract(doc) {
    const win = doc.defaultView;
    const cs = (el, pseudo) => win.getComputedStyle(el, pseudo);
    const rect = (el) => el.getBoundingClientRect();
    const warnings = [];
    const pending = [];           // rasterisations to await before returning

    /* ------------------------------------------------------------ colour */
    function parseColor(c) {
      const m = c && c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    const hex = (c) => [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const over = (c, bg) => (c ? { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 } : bg);
    function effectiveBg(el) {
      const stack = [];
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const c = parseColor(cs(e).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      let out = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
      return out;
    }

    /* -------------------------------------------------------------- text */
    const firstFamily = (ff) => ff.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    function runStyle(el) {
      const s = cs(el);
      return {
        family: firstFamily(s.fontFamily), weight: +s.fontWeight || 400, italic: s.fontStyle === 'italic',
        sizePt: round(px(s.fontSize) * PT), color: hex(over(parseColor(s.color), effectiveBg(el))),
        spacingPt: s.letterSpacing === 'normal' ? 0 : round(px(s.letterSpacing) * PT),
        upper: s.textTransform === 'uppercase',
      };
    }
    function runsOf(block) {
      const runs = [];
      (function visit(node) {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) {
            let t = n.data.replace(/\s+/g, ' ');
            if (!t) continue;
            const st = runStyle(n.parentElement);
            if (st.upper) t = t.toUpperCase();
            runs.push({ text: t, ...st });
          } else if (n.nodeType === 1) {
            if (cs(n).display === 'none') continue;
            if (n.tagName === 'BR') { runs.push({ br: true }); continue; }
            visit(n);
          }
        }
      })(block);
      // CSS white-space collapsing across run boundaries, and trimming at block edges and around <br>.
      runs.forEach((cur, i) => {
        const prev = runs[i - 1];
        if (cur.text && (!prev || prev.br || (prev.text && prev.text.endsWith(' ')))) cur.text = cur.text.replace(/^ /, '');
      });
      for (let i = runs.length - 1; i >= 0; i--) {
        const next = runs[i + 1], cur = runs[i];
        if (cur.text && (!next || next.br)) cur.text = cur.text.replace(/ $/, '');
      }
      return runs.filter((x) => x.text !== '');
    }
    const hasText = (el) => el.textContent.trim().length > 0;
    const isImage = (el) => el.tagName === 'IMG' || el.tagName.toLowerCase() === 'svg';
    function isInlineOnly(el) {
      for (const c of el.children) {
        const s = cs(c);
        if (s.position === 'absolute' || s.display === 'none') continue;
        if (!(s.display.startsWith('inline') || s.display === 'contents')) return false;
      }
      return true;
    }
    function beforeGlyph(el) {                        // li::before arrows and the like
      const b = cs(el, '::before'), c = b.content;
      if (!c || c === 'none' || c === 'normal') return null;
      const text = c.replace(/^["']|["']$/g, '');
      if (!text.trim()) return null;
      return { text, family: firstFamily(b.fontFamily), weight: +b.fontWeight || 400, italic: b.fontStyle === 'italic',
               sizePt: round(px(b.fontSize) * PT), color: hex(over(parseColor(b.color), effectiveBg(el))) };
    }
    function contentBox(el) {
      const b = rect(el), s = cs(el);
      return { left: b.left + px(s.borderLeftWidth) + px(s.paddingLeft), right: b.right - px(s.borderRightWidth) - px(s.paddingRight),
               top: b.top + px(s.borderTopWidth) + px(s.paddingTop), bottom: b.bottom - px(s.borderBottomWidth) - px(s.paddingBottom) };
    }
    // Rendered lines, from the text's own boxes: works for line-height: normal too.
    function lineCount(el) {
      const r = doc.createRange();
      r.selectNodeContents(el);
      const qs = [...r.getClientRects()].filter((q) => q.width > 0.5).sort((a, b) => a.top - b.top);
      let lines = 0, bottom = -Infinity;
      for (const q of qs) { if (q.top >= bottom - 1) { lines++; bottom = q.bottom; } else bottom = Math.max(bottom, q.bottom); }
      return Math.max(1, lines);
    }
    function paragraph(el, frame, extra = {}) {
      const s = cs(el), b = rect(el), cb = contentBox(el);
      const lines = lineCount(el);
      const lh = px(s.lineHeight) || (cb.bottom - cb.top) / lines;
      if (el.querySelector('img, svg')) warnings.push(`An image inside the text "${el.textContent.trim().slice(0, 40)}" was left out.`);
      return {
        t: 'p', tag: el.tagName.toLowerCase(), runs: runsOf(el), bullet: beforeGlyph(el),
        align: s.textAlign === 'justify' ? 'justify' : s.textAlign === 'center' ? 'center'
          : (s.textAlign === 'right' || s.textAlign === 'end') ? 'right' : 'left',
        lineHeightPt: round(lh * PT),
        padTopPt: px(s.paddingTop) * PT, padBottomPt: px(s.paddingBottom) * PT,
        indentLeftPt: round((cb.left - frame.left) * PT), indentRightPt: round((frame.right - cb.right) * PT),
        hangingPt: 0,
        // Never wraps in the HTML: the builders give it slack so a wider font can't wrap it either.
        noWrap: lines <= el.querySelectorAll('br').length + 1,
        top: b.top, bottom: b.bottom,
        ...extra,
      };
    }
    // A flex row with an empty growing child between texts is a leader row (a contents line).
    function leaderRow(el) {
      if (!cs(el).display.includes('flex')) return null;
      const kids = [...el.children];
      const lead = kids.find((k) => !k.textContent.trim() && cs(k).flexGrow !== '0');
      if (!lead || kids.length < 3) return null;
      const i = kids.indexOf(lead);
      return { beforeEls: kids.slice(0, i), afterEls: kids.slice(i + 1), leader: lead };
    }
    function leaderParagraph(el, lr, frame) {
      const p = paragraph(el, frame);
      // Two right tabs, as the HTML has two boxes: dots end where the leader ends, and the page
      // number right-aligns in its own column. Word measures tab stops from the column's left edge.
      const lead = rect(lr.leader), last = rect(lr.afterEls[lr.afterEls.length - 1]);
      const dot = (cs(lr.leader).backgroundImage.match(/rgba?\([^)]+\)/) || [])[0];
      const tabStyle = runStyle(lr.leader);
      p.runs = [...lr.beforeEls.flatMap(runsOf),
        { tab: true, ...tabStyle, ...(dot ? { color: hex(over(parseColor(dot), effectiveBg(lr.leader))) } : {}) },
        { tab: true, ...tabStyle }, ...lr.afterEls.flatMap(runsOf)];
      p.tabs = [{ leader: 'dot', posPt: round((lead.right - frame.left) * PT) }, { leader: 'none', posPt: round((last.right - frame.left) * PT) }];
      return p;
    }
    function isColumns(el) {
      const s = cs(el);
      if (!(s.display.includes('grid') || s.display.includes('flex'))) return null;
      const kids = [...el.children].filter((k) => cs(k).display !== 'none' && cs(k).position !== 'absolute');
      if (kids.length < 2) return null;
      const lefts = kids.map((k) => Math.round(rect(k).left));
      if (new Set(lefts).size !== kids.length) return null;          // stacked, not side by side
      const t0 = rect(kids[0]).top;
      return kids.every((k) => Math.abs(rect(k).top - t0) < 3) || s.alignItems !== 'normal' ? kids : null;
    }
    function borderOf(s, side) {
      const w = px(s[`border${side}Width`]);
      if (!w || s[`border${side}Style`] === 'none') return null;
      return { widthPt: round(w * PT), color: hex(parseColor(s[`border${side}Color`]) || { r: 0, g: 0, b: 0, a: 1 }) };
    }
    function isBoxed(el) {
      const s = cs(el), bg = parseColor(s.backgroundColor);
      return (bg && bg.a > 0) || ['Top', 'Right', 'Bottom', 'Left'].some((sd) => borderOf(s, sd));
    }
    function cellOf(el) {
      const s = cs(el), b = rect(el), cb = contentBox(el);
      const bg = parseColor(s.backgroundColor);
      // A cell that is itself the paragraph: its padding is already the cell margin, so don't count it twice.
      const blocks = isInlineOnly(el) && hasText(el)
        ? [{ ...paragraph(el, cb), padTopPt: 0, padBottomPt: 0, top: cb.top, bottom: cb.bottom }]
        : walk(el, cb);
      fixSpacing(blocks, cb.top);
      return {
        widthPt: round(b.width * PT), span: el.colSpan || 1,
        fill: bg && bg.a > 0 ? hex(over(bg, effectiveBg(el.parentElement))) : null,
        pad: { t: px(s.paddingTop) * PT, r: px(s.paddingRight) * PT, b: px(s.paddingBottom) * PT, l: px(s.paddingLeft) * PT },
        borders: { top: borderOf(s, 'Top'), right: borderOf(s, 'Right'), bottom: borderOf(s, 'Bottom'), left: borderOf(s, 'Left') },
        valign: s.verticalAlign === 'middle' ? 'center' : s.verticalAlign === 'bottom' ? 'bottom' : 'top',
        blocks: strip(blocks),
      };
    }
    // Side-by-side elements as one borderless row; the gaps become spacer columns so widths stay exact.
    function columnsFrom(els, frame) {
      els = [...els].sort((a, b) => rect(a).left - rect(b).left);
      const cells = [];
      els.forEach((el, i) => {
        const gap = rect(el).left - (i ? rect(els[i - 1]).right : frame.left);
        if (gap > 0.5) cells.push({ widthPt: round(gap * PT), span: 1, spacer: true, fill: null, pad: { t: 0, r: 0, b: 0, l: 0 }, borders: {}, valign: 'top', blocks: [] });
        cells.push(cellOf(el));
      });
      return { t: 'table', kind: 'columns', rows: [{ cells }], indentLeftPt: 0,
        widthPt: round((Math.max(...els.map((e) => rect(e).right)) - frame.left) * PT),
        top: Math.min(...els.map((e) => rect(e).top)), bottom: Math.max(...els.map((e) => rect(e).bottom)) };
    }
    function tableOf(el, frame, kind) {
      const b = rect(el);
      if (kind === 'columns') {
        const t = columnsFrom(isColumns(el), { left: b.left });
        return { ...t, indentLeftPt: round((b.left - frame.left) * PT), top: b.top, bottom: b.bottom };
      }
      const rows = kind === 'table'
        ? [...el.rows].map((tr) => ({ header: tr.parentElement.tagName === 'THEAD', cells: [...tr.cells].map(cellOf) }))
        : [{ cells: [cellOf(el)] }];
      return { t: 'table', kind, rows, top: b.top, bottom: b.bottom, indentLeftPt: round((b.left - frame.left) * PT), widthPt: round(b.width * PT) };
    }
    function imageBlock(el, frame) {
      const b = rect(el);
      const block = { t: 'image', png: null, wPt: round(b.width * PT), hPt: round(b.height * PT), indentLeftPt: round((b.left - frame.left) * PT), top: b.top, bottom: b.bottom };
      pending.push(rasterise([el], b, b.width, b.height, 3).then((p) => { block.png = p; }));
      return block;
    }
    // The block walk over a flow container. Page-agnostic, so flowing documents reuse it as is.
    function walk(container, frame) {
      const out = [];
      for (const child of container.children) {
        const s = cs(child);
        if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue;
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        if (isImage(child)) { out.push(imageBlock(child, frame)); continue; }
        if (child.tagName === 'TABLE') { out.push(tableOf(child, frame, 'table')); continue; }
        const lr = leaderRow(child);
        if (lr) { out.push(leaderParagraph(child, lr, frame)); continue; }
        if (isInlineOnly(child)) {
          if (hasText(child)) out.push(paragraph(child, frame, child.tagName === 'LI' ? { hangingPt: px(s.paddingLeft) * PT } : {}));
          continue;
        }
        if (isColumns(child)) { out.push(tableOf(child, frame, 'columns')); continue; }
        if (isBoxed(child)) { out.push(tableOf(child, frame, 'box')); continue; }
        out.push(...walk(child, frame));
      }
      return out;
    }
    // All inter-block space rides on space-before: Word overlaps a paragraph's space-after with the
    // next one's space-before instead of adding them, so splitting it between the two loses some.
    function fixSpacing(blocks, frameTop) {
      let prevBottom = frameTop, carry = 0;
      blocks.forEach((b, i) => {
        b.spaceBeforePt = round((b.top - prevBottom) * PT + (b.padTopPt || 0) + carry);
        carry = b.padBottomPt || 0;
        b.spaceAfterPt = i === blocks.length - 1 ? round(carry) : 0;
        prevBottom = b.bottom;
      });
    }
    function strip(blocks) {                          // drop DOM-only geometry from the model
      return blocks.map(({ top, bottom, padTopPt, padBottomPt, ...rest }) => rest);
    }
    // Script-generated page numbers become live fields. Whole small runs only, so a display numeral stays text.
    function markPageNumber(runs, n) {
      return runs.map((r) => {
        if (r.text == null || r.text.trim() !== String(n) || r.sizePt > 12) return r;
        const { text, ...style } = r;
        return { ...style, field: 'PAGE' };
      });
    }

    /* -------------------------------------------------------- decoration */
    function radii(s, w, h) {
      const corner = (v) => {
        const p = v.split(' '), a = p[0], b = p[1] || p[0];
        const conv = (x, full) => (x.endsWith('%') ? parseFloat(x) / 100 * full : px(x));
        return [conv(a, w), conv(b, h)];
      };
      const c = [corner(s.borderTopLeftRadius), corner(s.borderTopRightRadius), corner(s.borderBottomRightRadius), corner(s.borderBottomLeftRadius)];
      const f = Math.min(1, w / (c[0][0] + c[1][0] || 1), w / (c[3][0] + c[2][0] || 1), h / (c[0][1] + c[3][1] || 1), h / (c[1][1] + c[2][1] || 1));
      return c.map(([x, y]) => [x * f, y * f]);            // CSS radius clamping
    }
    function roundedPath(x, y, w, h, [tl, tr, br, bl]) {
      return `M${x + tl[0]},${y}H${x + w - tr[0]}A${tr[0]},${tr[1]} 0 0 1 ${x + w},${y + tr[1]}V${y + h - br[1]}`
        + `A${br[0]},${br[1]} 0 0 1 ${x + w - br[0]},${y + h}H${x + bl[0]}A${bl[0]},${bl[1]} 0 0 1 ${x},${y + h - bl[1]}`
        + `V${y + tl[1]}A${tl[0]},${tl[1]} 0 0 1 ${x + tl[0]},${y}Z`;
    }
    let gradId = 0;
    function gradientDef(bgImage, id) {
      const m = bgImage.match(/linear-gradient\((.*)\)$/);
      if (!m) return null;
      const parts = m[1].split(/,(?![^(]*\))/).map((x) => x.trim());
      let angle = 180;
      if (/deg$/.test(parts[0])) angle = parseFloat(parts.shift());
      else if (/^to /.test(parts[0])) angle = { 'to right': 90, 'to left': 270, 'to top': 0, 'to bottom': 180 }[parts.shift()] ?? 180;
      const stops = parts.map((p, i) => {
        const cm = p.match(/rgba?\([^)]+\)/);
        const pos = p.replace(cm[0], '').trim();
        return { c: parseColor(cm[0]), o: pos ? parseFloat(pos) / 100 : i / (parts.length - 1) };
      });
      const a = (angle - 90) * Math.PI / 180;
      return `<linearGradient id="${id}" x1="${0.5 - Math.cos(a) / 2}" y1="${0.5 - Math.sin(a) / 2}" x2="${0.5 + Math.cos(a) / 2}" y2="${0.5 + Math.sin(a) / 2}">`
        + stops.map((st) => `<stop offset="${st.o}" stop-color="#${hex(st.c)}" stop-opacity="${st.c.a}"/>`).join('') + '</linearGradient>';
    }
    function svgInline(svg, x, y, b) {
      const clone = svg.cloneNode(true);
      const color = cs(svg).color;
      clone.querySelectorAll('use').forEach((u) => {
        const ref = doc.querySelector(u.getAttribute('href') || u.getAttribute('xlink:href'));
        if (!ref) return;
        const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = ref.innerHTML;
        u.replaceWith(g);
      });
      clone.removeAttribute('style'); clone.removeAttribute('class');
      clone.setAttribute('x', x); clone.setAttribute('y', y); clone.setAttribute('width', b.width); clone.setAttribute('height', b.height);
      return clone.outerHTML.replace(/currentColor/g, color);
    }
    function paintOf(el, origin, defs) {
      const s = cs(el), b = rect(el), x = b.left - origin.left, y = b.top - origin.top;
      let out = '';
      const bg = parseColor(s.backgroundColor);
      const d = roundedPath(x, y, b.width, b.height, radii(s, b.width, b.height));
      if (bg && bg.a > 0) out += `<path d="${d}" fill="#${hex(bg)}" fill-opacity="${bg.a * +s.opacity}"/>`;
      if (s.backgroundImage.startsWith('linear-gradient')) {
        const id = 'g' + (gradId++), g = gradientDef(s.backgroundImage, id);
        if (g) { defs.push(g); out += `<path d="${d}" fill="url(#${id})"/>`; }
      }
      if (el.tagName.toLowerCase() === 'svg') out += svgInline(el, x, y, b);
      return out;
    }
    const inSvg = (e) => !!(e.parentElement && e.parentElement.closest('svg'));
    function hasPaint(el) {
      if (inSvg(el)) return false;
      const s = cs(el), bg = parseColor(s.backgroundColor);
      return (bg && bg.a > 0) || s.backgroundImage.startsWith('linear-gradient') || isImage(el);
    }
    // Paint elements in order onto one canvas. <img> is drawn directly (an SVG-as-image can't load
    // it); everything else goes through an SVG layer, flushed whenever an image interrupts it.
    async function rasterise(elements, origin, w, h, scale) {
      const cv = doc.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale));
      const g = cv.getContext('2d');
      let defs = [], body = '', painted = false;
      const flush = async () => {
        if (!body) return;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cv.width}" height="${cv.height}" viewBox="0 0 ${w} ${h}"><defs>${defs.join('')}</defs>${body}</svg>`;
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try { const img = new Image(); img.src = url; await img.decode(); g.drawImage(img, 0, 0, cv.width, cv.height); painted = true; }
        finally { URL.revokeObjectURL(url); }
        defs = []; body = '';
      };
      for (const el of elements) {
        if (el.tagName === 'IMG') {
          await flush();
          const b = rect(el);
          try { g.drawImage(el, (b.left - origin.left) * scale, (b.top - origin.top) * scale, b.width * scale, b.height * scale); painted = true; }
          catch { warnings.push(`An image (${(el.getAttribute('src') || '').slice(0, 60)}) could not be copied.`); }
        } else body += paintOf(el, origin, defs);
      }
      await flush();
      if (!painted) return null;
      try { return cv.toDataURL('image/png'); }
      catch { warnings.push('An image from another website could not be copied into the export.'); return null; }
    }
    async function layerOf(page, keep) {
      const pr = rect(page);
      const els = [page, ...page.querySelectorAll('*')].filter((e) => keep(e) && cs(e).display !== 'none' && hasPaint(e));
      const bg = parseColor(cs(page).backgroundColor);
      if (!els.length || (els.length === 1 && els[0] === page && (!bg || hex(bg) === 'FFFFFF'))) return null;
      return rasterise(els, pr, pr.width, pr.height, 2);
    }

    /* --------------------------------------------------------- documents */
    // Header and footer: positioned text above or below the content box, found by geometry, not by class.
    async function furniture(page, flowRoot, frame, n) {
      const pr = rect(page), picked = [], zones = { header: [], footer: [] };
      for (const el of page.querySelectorAll('*')) {
        if (el === flowRoot || flowRoot.contains(el) || picked.some((p) => p.contains(el)) || inSvg(el)) continue;
        const s = cs(el);
        if (s.position !== 'absolute' || s.display === 'none' || s.visibility === 'hidden') continue;
        if (!hasText(el) && !el.querySelector('svg, img') && !isImage(el)) continue;     // pure decoration: the layer takes it
        const b = rect(el);
        const zone = b.bottom <= frame.top + 1 ? 'header' : b.top >= frame.bottom - 1 ? 'footer' : null;
        if (!zone) {
          if (hasText(el)) warnings.push(`Page ${n}: text outside the page's content area ("${el.textContent.trim().slice(0, 40)}") was left out.`);
          continue;
        }
        picked.push(el);
        zones[zone].push(el);
      }
      const itemsOf = (el) => (isImage(el) ? [{ el, image: true }]
        : isInlineOnly(el) && !el.querySelector('svg, img') && hasText(el) ? [{ el }]
        : [...el.children].filter((k) => cs(k).display !== 'none').flatMap(itemsOf));
      async function row(els) {
        const items = els.flatMap(itemsOf).map((it) => ({ ...it, b: rect(it.el) })).sort((a, b) => a.b.left - b.b.left);
        const cells = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i], left = i === 0 ? frame.left : it.b.left;
          const right = i === items.length - 1 ? frame.right : items[i + 1].b.left;
          const cell = { widthPt: round((right - left) * PT), align: 'left' };
          if (it.image) cell.image = { png: await rasterise([it.el], it.b, it.b.width, it.b.height, 8), wPt: round(it.b.width * PT), hPt: round(it.b.height * PT) };
          else cell.runs = markPageNumber(runsOf(it.el), n);
          if (i > 0 && i === items.length - 1 && Math.abs(it.b.right - frame.right) < 4) cell.align = 'right';
          else if (items.length === 1 && Math.abs((it.b.left + it.b.right) / 2 - (frame.left + frame.right) / 2) < 4) cell.align = 'center';
          else if (i === 0 && it.b.left - frame.left > 0.5) cell.indentPt = round((it.b.left - frame.left) * PT);
          cells.push(cell);
        }
        return { cells, top: Math.min(...items.map((x) => x.b.top)), bottom: Math.max(...items.map((x) => x.b.bottom)) };
      }
      const out = { picked, header: null, footer: null };
      if (zones.header.length) { const r = await row(zones.header); out.header = { distMM: round((r.top - pr.top) * MM, 1), rows: [{ cells: r.cells }] }; }
      if (zones.footer.length) { const r = await row(zones.footer); out.footer = { distMM: round((pr.bottom - r.bottom) * MM, 1), rows: [{ cells: r.cells }] }; }
      return out;
    }

    // A page with no content box (a cover, a full-bleed panel): its text becomes ordinary paragraphs,
    // top to bottom, with side-by-side items as a borderless row. Only its decoration is an image.
    async function flatten(page, n) {
      const pr = rect(page);
      const leaves = [];
      for (const el of page.querySelectorAll('*')) {
        if (inSvg(el) || el.tagName.toLowerCase() === 'svg') continue;
        const s = cs(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.display.startsWith('inline')) continue;
        if (!hasText(el) || !isInlineOnly(el) || leaves.some((l) => l.contains(el))) continue;
        leaves.push(el);
      }
      const size = { widthMM: round(pr.width * MM, 1), heightMM: round(pr.height * MM, 1), flattened: true, header: null, footer: null };
      const layer = await layerOf(page, () => true);
      if (!leaves.length) return { ...size, margins: { top: 10, left: 10, right: 10, bottom: 10 }, blocks: [], layer };
      const boxes = leaves.map((el) => ({ el, b: rect(el) })).sort((a, b) => a.b.top - b.b.top || a.b.left - b.b.left);
      const rows = [];
      for (const x of boxes) {
        const r = rows[rows.length - 1];
        if (r && x.b.top < r.bottom - Math.min(x.b.height, r.bottom - r.top) / 2) { r.els.push(x.el); r.bottom = Math.max(r.bottom, x.b.bottom); }
        else rows.push({ els: [x.el], top: x.b.top, bottom: x.b.bottom });
      }
      const left = Math.min(...boxes.map((x) => x.b.left)), right = Math.max(...boxes.map((x) => x.b.right));
      const frame = { left, right, top: rows[0].top, bottom: pr.bottom };
      const blocks = rows.map((r) => {
        if (r.els.length > 1) return columnsFrom(r.els, frame);
        const p = paragraph(r.els[0], frame);
        p.runs = markPageNumber(p.runs, n);
        return p;
      });
      fixSpacing(blocks, frame.top);
      const lastBottom = Math.max(...boxes.map((x) => x.b.bottom));
      return { ...size, layer, blocks: strip(blocks),
        margins: { top: round((frame.top - pr.top) * MM, 1), left: round((left - pr.left) * MM, 1), right: round((pr.right - right) * MM, 1),
                   bottom: round(Math.max(2, Math.min(10, (pr.bottom - lastBottom) * MM - 1)), 1) } };
    }

    async function documentModel(pages) {
      const out = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i], n = i + 1, pr = rect(page);
        const flowRoot = page.querySelector('.page-body');
        if (!flowRoot) { out.push(await flatten(page, n)); continue; }
        const frame = contentBox(flowRoot);
        const blocks = walk(flowRoot, frame);
        fixSpacing(blocks, frame.top);
        const f = await furniture(page, flowRoot, frame, n);
        out.push({
          widthMM: round(pr.width * MM, 1), heightMM: round(pr.height * MM, 1), flattened: false,
          margins: { top: round((frame.top - pr.top) * MM, 1), left: round((frame.left - pr.left) * MM, 1),
                     right: round((pr.right - frame.right) * MM, 1), bottom: round((pr.bottom - frame.bottom) * MM, 1) },
          blocks: strip(blocks), header: f.header, footer: f.footer,
          layer: await layerOf(page, (e) => !flowRoot.contains(e) && !f.picked.some((p) => p.contains(e))),
        });
      }
      return out;
    }

    /* ------------------------------------------------------------- decks */
    function showAllSlides(slides) {
      doc.body.classList.add('scroll-mode');          // both templates' "every slide visible" convention
      for (const s of slides) for (let a = s.parentElement; a && a !== doc.body; a = a.parentElement) a.style.transform = 'none';
      slides.forEach((s, i) => { if (!rect(s).width) warnings.push(`Slide ${i + 1} is hidden and could not be measured.`); });
    }
    async function deckModel(slides) {
      showAllSlides(slides);
      const out = [];
      for (const slide of slides) {
        const sr = rect(slide), items = [], handled = new Set();
        const pos = (b) => ({ x: round((b.left - sr.left) * PT), y: round((b.top - sr.top) * PT), w: round(b.width * PT), h: round(b.height * PT) });
        for (const el of slide.querySelectorAll('*')) {
          const s = cs(el);
          if (s.display === 'none' || s.visibility === 'hidden' || inSvg(el)) continue;
          const b = rect(el);
          if (hasPaint(el)) {
            const bg = parseColor(s.backgroundColor), c = radii(s, b.width, b.height);
            const uniform = c.every((k) => Math.abs(k[0] - c[0][0]) < 0.5 && Math.abs(k[1] - c[0][0]) < 0.5);
            if (bg && bg.a > 0 && !s.backgroundImage.startsWith('linear-gradient') && !isImage(el) && uniform) {
              const circle = Math.abs(b.width - b.height) < 1 && c[0][0] >= b.width / 2 - 0.5;
              items.push({ t: 'shape', shape: circle ? 'ellipse' : c[0][0] > 0.5 ? 'roundRect' : 'rect', radiusPt: round(c[0][0] * PT),
                fill: hex(bg), alpha: bg.a * +s.opacity, shadow: s.boxShadow !== 'none' ? s.boxShadow : null, ...pos(b) });
            } else {
              const png = await rasterise([el], b, b.width, b.height, 3);
              if (png) items.push({ t: 'image', png, ...pos(b) });
            }
          }
          if (handled.has(el)) continue;
          if (el.tagName === 'UL' || el.tagName === 'OL') {           // one box per list, so Enter adds a bullet
            const cb = contentBox(el);
            const paras = [...el.children].filter((li) => li.tagName === 'LI').map((li) => {
              handled.add(li); li.querySelectorAll('*').forEach((k) => handled.add(k));
              return paragraph(li, cb, { hangingPt: px(cs(li).paddingLeft) * PT });
            });
            fixSpacing(paras, cb.top);
            items.push({ t: 'text', ...pos({ left: rect(el).left, top: cb.top, width: rect(el).width, height: cb.bottom - cb.top }), paras: strip(paras) });
            continue;
          }
          if (!s.display.startsWith('inline') && isInlineOnly(el) && hasText(el) && !el.closest('li')) {
            const cb = contentBox(el);
            const p = { ...paragraph(el, cb), spaceBeforePt: 0, spaceAfterPt: 0 };
            items.push({ t: 'text', ...pos({ left: cb.left, top: cb.top, width: cb.right - cb.left, height: cb.bottom - cb.top }), paras: strip([p]) });
            el.querySelectorAll('*').forEach((k) => handled.add(k));
          }
        }
        const bg = parseColor(cs(slide).backgroundColor);
        out.push({ bg: bg ? hex(bg) : 'FFFFFF', wPt: round(sr.width * PT), hPt: round(sr.height * PT), items });
      }
      return out;
    }

    /* ------------------------------------------------------------- model */
    const k = X.detectKind(doc);
    if (k.kind === 'unsupported') throw new Error(k.reason);
    const model = { version: 1, kind: k.kind, pagination: 'fixed', lang: doc.documentElement.lang || 'en-GB', title: doc.title || '', warnings };
    if (k.kind === 'deck') model.slides = await deckModel(k.cards);
    else { model.base = runStyle(doc.body); model.pages = await documentModel(k.cards); }
    await Promise.all(pending);
    return model;
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Verify the model in the browser against the fixtures**

Start the preview: `preview_start` with `{ name: "editor" }`, then navigate to `http://localhost:8765/test/fixtures/export-harness.html?v=1`. Run this with `javascript_tool`:

```js
const m = await extractFixture('/test/fixtures/export-doc.html');
const p = m.pages;
({
  pages: p.length, cover: p[0].flattened, coverLayer: !!p[0].layer, coverFirst: p[0].blocks[0].runs.map((r) => r.text || '⏎').join(''),
  footerPages: p.filter((x) => x.footer).length,
  footerHasPageField: p[2].footer.rows[0].cells.some((c) => (c.runs || []).some((r) => r.field === 'PAGE')),
  footerHasLogo: p[2].footer.rows[0].cells.some((c) => c.image && c.image.png),
  contentsTabs: p[1].blocks[1].tabs, contentsTabRuns: p[1].blocks[1].runs.filter((r) => r.tab).length,
  p3kinds: p[2].blocks.map((b) => b.t === 'table' ? b.kind : b.tag),
  warnings: m.warnings,
})
```

Expected:
- `pages: 5`, `cover: true`, `coverLayer: true`, `coverFirst: "Export⏎Trial Document"`.
- `footerPages: 4`, `footerHasPageField: true`, `footerHasLogo: true`.
- `contentsTabs`: two entries, `leader: 'dot'` then `leader: 'none'`, with the second `posPt` about 453.5. `contentsTabRuns: 2`.
- `p3kinds`: `['h1', 'p', 'box', 'h2', 'p', 'h3', 'li', 'li', 'li', 'table']`.
- `warnings: []`.

Then run the deck:

```js
const d = await extractFixture('/test/fixtures/export-deck.html');
const count = (s, t) => s.items.filter((i) => i.t === t).length;
({ slides: d.slides.length, s1: { shape: count(d.slides[0], 'shape'), image: count(d.slides[0], 'image'), text: count(d.slides[0], 'text') }, s6shapes: d.slides[5].items.filter((i) => i.t === 'shape').map((i) => i.shape),
   s3list: d.slides[2].items.find((i) => i.t === 'text' && i.paras.length === 2).paras.map((p) => p.bullet && p.bullet.text), warnings: d.warnings })
```

Expected:
- `slides: 8`.
- `s1` is `{ shape: 3, image: 4, text: 3 }`:
  - shapes: the two panels and the circular motif piece;
  - images: the three quarter-round motif pieces and the logo;
  - text: title, subtitle and date.
- `s6shapes: ['roundRect', 'roundRect']`.
- `s3list: ['→', '→']`.
- `warnings: []`.

If a value differs, fix `extract.js` and reload with a new `?v=`. Don't adjust the expectations to fit the output.

- [ ] **Step 5: Commit**

```bash
git add src/export/extract.js test/fixtures/export-doc.html test/fixtures/export-deck.html test/fixtures/export-harness.html
git commit -m "Extract a layout model from a rendered document or deck, for export"
```

---

### Task 4: `docx.js`, the model turned into a Word document

**Files:**
- Create: `src/export/docx.js`
- Test: `test/export/docx.test.mjs`

**Interfaces:**
- **Consumes:**
  - the `Model` / `Page` / `Block` shapes from Task 3;
  - `HepExport.fonts.{faceMapper, lineRatio, officeFamilies, odttf, base64ToBytes}` from Task 2.
- **Produces:** `HepExport.toDocx(model, fonts, { docx, JSZip }) → Promise<{ bytes: Uint8Array, faces: string[] }>`. Its internal `run()` has the extension point `glyphFonts(r, face)`, which returns `null` until Task 7.

- [ ] **Step 1: Write the failing tests `test/export/docx.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HepExport, libs, bundledFonts } from './load.mjs';

const run = (text, o = {}) => ({ text, family: 'DM Sans', weight: 400, italic: false, sizePt: 10.5, color: '2C2C2C', spacingPt: 0, upper: false, ...o });
const para = (runs, o = {}) => ({ t: 'p', tag: 'p', runs, bullet: null, align: 'left', lineHeightPt: 17.85, spaceBeforePt: 0, spaceAfterPt: 0,
  indentLeftPt: 0, indentRightPt: 0, hangingPt: 0, noWrap: false, ...o });
const footer = { distMM: 9, rows: [{ cells: [{ widthPt: 400, align: 'left', runs: [{ field: 'PAGE', ...run('') }, run(' | Doc')] }, { widthPt: 53.5, align: 'right', runs: [run('x')] }] }] };
const page = (blocks, o = {}) => ({ widthMM: 210, heightMM: 297, flattened: false, margins: { top: 22, left: 25, right: 25, bottom: 24 },
  blocks, header: null, footer, layer: null, ...o });
const model = (pages) => ({ version: 1, kind: 'document', pagination: 'fixed', lang: 'en-GB', title: 'Test', base: run(''), pages, warnings: [] });

async function build(m) {
  const out = await HepExport.toDocx(m, await bundledFonts(), libs);
  const zip = await libs.JSZip.loadAsync(out.bytes);
  const read = (n) => zip.file(n) ? zip.file(n).async('string') : null;
  return { out, zip, read };
}

test('one Word page per HTML page, with no exact line spacing anywhere', async () => {
  const { read } = await build(model([page([para([run('One')])]), page([para([run('Two')])]), page([para([run('Three')])])]));
  const doc = await read('word/document.xml');
  assert.equal((doc.match(/<w:pageBreakBefore\/>/g) || []).length, 2);
  assert.ok(!/lineRule="exact"/.test(doc), 'Google Docs misreads exact spacing');
  assert.match(doc, /w:lineRule="auto"/);
});

test('embeds every slot a family uses, obfuscated', async () => {
  const { zip, read } = await build(model([page([para([run('Reg'), run('Bold', { weight: 700 }), run('Semi', { weight: 600 })])])]));
  const ft = await read('word/fontTable.xml');
  assert.match(ft, /<w:font w:name="DM Sans">[\s\S]*?<w:embedRegular [^>]*w:fontKey="\{[0-9A-F-]{36}\}"[\s\S]*?<w:embedBold /);
  assert.match(ft, /<w:font w:name="DM Sans SemiBold">[\s\S]*?<w:embedRegular /);
  assert.ok(Object.keys(zip.files).filter((n) => n.endsWith('.odttf')).length >= 3);
  assert.match(await read('[Content_Types].xml'), /Extension="odttf"/);
  const st = await read('word/settings.xml');
  assert.ok(st.indexOf('embedTrueTypeFonts') > -1 && st.indexOf('embedTrueTypeFonts') < st.indexOf('autoHyphenation'), 'schema order');
});

test('contents rows get two right tabs measured from the margin, dots then none', async () => {
  const p = para([run('Intro'), { tab: true, ...run('', { color: '888888' }) }, { tab: true, ...run('') }, run('3')],
    { indentLeftPt: 28, tabs: [{ leader: 'dot', posPt: 402.5 }, { leader: 'none', posPt: 453.5 }] });
  const doc = await (await build(model([page([p])]))).read('word/document.xml');
  // docx 9.7.1 writes the attributes as val, pos, leader.
  assert.match(doc, /<w:tab w:val="right" w:pos="8050" w:leader="dot"\/>/);
  assert.match(doc, /<w:tab w:val="right" w:pos="9070" w:leader="none"\/>/);
});

test('the footer carries a live page number; a section without one says so explicitly', async () => {
  const cover = page([para([run('Cover')])], { flattened: true, footer: null, margins: { top: 30, left: 30, right: 30, bottom: 10 } });
  const { zip, read } = await build(model([cover, page([para([run('Body')])])]));
  const footers = Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
  const texts = await Promise.all(footers.map(read));
  assert.ok(texts.some((t) => /PAGE/.test(t)), 'a PAGE field in the body footer');
  assert.ok(texts.some((t) => !/PAGE/.test(t)), 'an empty footer for the cover, not an inherited one');
  assert.equal(((await read('word/document.xml')).match(/<w:sectPr/g) || []).length, 2);
});

test('headings suppress hyphenation, and lines that never wrap get slack', async () => {
  const doc = await (await build(model([page([para([run('Title', { sizePt: 32, weight: 700 })], { tag: 'h1', noWrap: true })])]))).read('word/document.xml');
  assert.match(doc, /<w:suppressAutoHyphens\/>/);
  assert.match(doc, /w:right="-800"/);
});

test('the document language is set', async () => {
  const st = await (await build(model([page([para([run('x')])])]))).read('word/styles.xml');
  assert.match(st, /w:lang w:val="en-GB"/);
});

test('no editor instrumentation can appear in the output', async () => {
  const { zip } = await build(model([page([para([run('x')])])]));
  for (const n of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(n)) continue;
    assert.ok(!/data-hep|contenteditable|hep-highlight|hep-font-substitutes|data-hep-logo/.test(await zip.file(n).async('string')), n);
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/export/docx.test.mjs`
Expected: FAIL, `HepExport.toDocx is not a function`.

- [ ] **Step 3: Write `src/export/docx.js`**

```js
/*
 * Layout model -> .docx. One Word page per HTML page; native paragraphs, heading styles
 * and lists; boxes and columns as tables. Most rules here were forced by Google Docs'
 * importer or by Word itself; CLAUDE.md "Exporting" records why each exists.
 */
(function (root) {
  'use strict';
  const X = (root.HepExport ||= {});

  X.toDocx = async function toDocx(model, fonts, { docx: D, JSZip }) {
    const F = X.fonts;
    const face = F.faceMapper(fonts);
    const used = new Set();
    const tw = (pt) => Math.round(pt * 20);                    // twips
    const mmTw = (mm) => Math.round(mm / 25.4 * 1440);
    const png = (d) => F.base64ToBytes(d.slice(d.indexOf(',') + 1));
    const AL = { justify: D.AlignmentType.JUSTIFIED, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, left: D.AlignmentType.LEFT };
    const HEAD = { h1: D.HeadingLevel.HEADING_1, h2: D.HeadingLevel.HEADING_2, h3: D.HeadingLevel.HEADING_3, h4: D.HeadingLevel.HEADING_4 };
    const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'auto' };
    const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
    const CELL_NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
    const ZERO = { top: 0, bottom: 0, left: 0, right: 0, marginUnitType: D.WidthType.DXA };
    const glyphFonts = () => null;                              // Task 7 replaces this

    // Proportional spacing only: Google Docs reads an exact line height as a multiple.
    function lineSpacing(p) {
      const main = p.runs.find((r) => r.text) || p.runs[0] || model.base;
      const f = face(main.family, main.weight, main.italic);
      return { line: Math.round(240 * p.lineHeightPt / (main.sizePt * F.lineRatio(f.font))), lineRule: D.LineRuleType.AUTO };
    }
    function run(r) {
      if (r.br) return new D.TextRun({ break: 1 });
      const f = face(r.family, r.weight, r.italic);
      used.add(f.face);
      const o = { font: glyphFonts(r, f) || f.face, bold: f.bold, italics: f.italics, size: Math.round(r.sizePt * 2), color: r.color,
                  characterSpacing: r.spacingPt ? tw(r.spacingPt) : undefined };
      if (r.tab) return new D.TextRun({ ...o, children: [new D.Tab()] });
      if (r.field === 'PAGE') return new D.TextRun({ ...o, children: [D.PageNumber.CURRENT] });
      return new D.TextRun({ ...o, text: r.text });
    }

    // Bullets: one numbering definition per glyph/indent/colour, so lists stay real Word lists.
    const bulletDefs = new Map();
    function bulletRef(p) {
      const b = p.bullet, k = [b.text, b.color, b.weight, p.indentLeftPt, p.hangingPt].join('|');
      if (!bulletDefs.has(k)) {
        const f = face(b.family, b.weight, b.italic);
        used.add(f.face);
        bulletDefs.set(k, { reference: 'bullet' + bulletDefs.size, levels: [{ level: 0, format: D.LevelFormat.BULLET, text: b.text, alignment: D.AlignmentType.LEFT,
          style: { run: { font: f.face, bold: f.bold, color: b.color, size: Math.round(b.sizePt * 2) },
                   paragraph: { indent: { left: tw(p.indentLeftPt), hanging: tw(p.hangingPt) } } } }] });
      }
      return bulletDefs.get(k).reference;
    }

    function para(p, { pageBreak = false, spaceAfterPt = null, floating = null, inCell = false } = {}) {
      const children = p.runs.map(run);
      if (floating) children.unshift(floating);
      // A line that never wraps gets slack on the side it grows towards, so a wider font can't wrap it.
      const slackL = p.noWrap && !inCell && (p.align === 'right' || p.align === 'center');
      const slackR = p.noWrap && !inCell && p.align !== 'right';
      return new D.Paragraph({
        children, heading: HEAD[p.tag], alignment: AL[p.align],
        spacing: { before: tw(Math.max(0, p.spaceBeforePt)), after: tw(Math.max(0, spaceAfterPt ?? p.spaceAfterPt)), ...lineSpacing(p) },
        keepLines: (p.noWrap || /^h\d$/.test(p.tag)) || undefined,     // marker: also gets suppressAutoHyphens below
        indent: { left: slackL ? -tw(40) : tw(p.indentLeftPt), right: slackR ? -tw(40) : tw(Math.max(0, p.indentRightPt)),
                  ...(p.bullet ? { hanging: tw(p.hangingPt) } : {}) },
        numbering: p.bullet ? { reference: bulletRef(p), level: 0 } : undefined,
        tabStops: p.tabs ? p.tabs.map((t) => ({ type: D.TabStopType.RIGHT, position: tw(t.posPt), leader: t.leader === 'dot' ? D.LeaderType.DOT : D.LeaderType.NONE })) : undefined,
        pageBreakBefore: pageBreak || undefined,
        widowControl: false,
      });
    }
    // A 1pt line carrying a gap as space-before. The paragraph mark is sized too, or the line is body-text tall.
    const spacer = (pt, pageBreak, extra = []) => new D.Paragraph({
      children: [...extra, new D.TextRun({ text: '', size: 2 })], run: { size: 2 }, pageBreakBefore: pageBreak || undefined,
      spacing: { before: tw(Math.max(0, pt - 1.3)), after: 0, line: 240, lineRule: D.LineRuleType.AUTO }, widowControl: false });
    const border = (b) => (b ? { style: D.BorderStyle.SINGLE, size: Math.max(2, Math.round(b.widthPt * 8)), color: b.color } : NONE);

    function table(t) {
      const widthRow = t.rows.find((r) => r.cells.every((c) => (c.span || 1) === 1)) || t.rows[0];
      const cols = widthRow.cells.map((c) => tw(c.widthPt));
      return new D.Table({
        layout: D.TableLayoutType.FIXED, width: { size: cols.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: cols,
        indent: { size: tw(t.indentLeftPt), type: D.WidthType.DXA }, borders: NO_BORDERS, margins: ZERO,
        rows: t.rows.map((rw) => new D.TableRow({ tableHeader: rw.header || undefined, cantSplit: true,
          children: rw.cells.map((c) => new D.TableCell({
            width: { size: tw(c.widthPt), type: D.WidthType.DXA }, columnSpan: c.span > 1 ? c.span : undefined,
            shading: c.fill ? { fill: c.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
            margins: { top: tw(c.pad.t), bottom: tw(c.pad.b), left: tw(c.pad.l), right: tw(c.pad.r), marginUnitType: D.WidthType.DXA },
            borders: { top: border(c.borders.top), bottom: border(c.borders.bottom), left: border(c.borders.left), right: border(c.borders.right) },
            verticalAlign: { center: D.VerticalAlign.CENTER, bottom: D.VerticalAlign.BOTTOM }[c.valign] || D.VerticalAlign.TOP,
            children: blocks(c.blocks, { inCell: true }),
          })) })),
      });
    }
    const imagePara = (b, pageBreak, floating) => new D.Paragraph({
      children: [...(floating ? [floating] : []), ...(b.png ? [new D.ImageRun({ type: 'png', data: png(b.png), transformation: { width: b.wPt / 0.75, height: b.hPt / 0.75 } })] : [])],
      indent: { left: tw(b.indentLeftPt) }, pageBreakBefore: pageBreak || undefined, widowControl: false,
      spacing: { before: tw(Math.max(0, b.spaceBeforePt)), after: tw(Math.max(0, b.spaceAfterPt)), line: 240, lineRule: D.LineRuleType.AUTO } });

    // Word has no space-before on a table: carry it on the preceding paragraph, or on a spacer.
    function blocks(list, { inCell = false, firstPageBreak = false, floating = null } = {}) {
      const out = [];
      list.forEach((b, i) => {
        const next = list[i + 1], brk = firstPageBreak && i === 0, fl = i === 0 ? floating : null;
        if (b.t === 'p') {
          const after = next && next.t === 'table' ? b.spaceAfterPt + next.spaceBeforePt : null;
          out.push(para(b, { pageBreak: brk, spaceAfterPt: after, floating: fl, inCell }));
        } else if (b.t === 'image') {
          out.push(imagePara(b, brk, fl));
        } else {
          const prev = list[i - 1];
          if (brk || !prev || prev.t !== 'p') out.push(spacer(b.spaceBeforePt, brk, fl ? [fl] : []));
          out.push(table(b));
        }
      });
      if (!list.length) out.push(spacer(0.5, firstPageBreak, floating ? [floating] : []));
      else if (list[list.length - 1].t === 'table') out.push(spacer(0.5, false));   // a cell or page must end in a paragraph
      return out;
    }
    function layerImage(pg) {
      if (!pg.layer) return null;
      return new D.ImageRun({ type: 'png', data: png(pg.layer), transformation: { width: pg.widthMM / 25.4 * 96, height: pg.heightMM / 25.4 * 96 },
        floating: { horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                    verticalPosition: { relative: D.VerticalPositionRelativeFrom.PAGE, offset: 0 },
                    behindDocument: true, allowOverlap: true, wrap: { type: D.TextWrappingType.NONE } } });
    }

    const tiny = () => new D.Paragraph({ children: [new D.TextRun({ text: '', size: 2 })], run: { size: 2 },
      spacing: { before: 0, after: 0, line: 240, lineRule: D.LineRuleType.AUTO } });
    function rowTable(row) {
      const widths = row.cells.map((c) => tw(c.widthPt));
      return new D.Table({
        layout: D.TableLayoutType.FIXED, width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: widths,
        borders: NO_BORDERS, margins: ZERO,
        rows: [new D.TableRow({ children: row.cells.map((c, i) => new D.TableCell({
          width: { size: widths[i], type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.CENTER, borders: CELL_NO_BORDERS,
          children: [new D.Paragraph({ alignment: AL[c.align] || D.AlignmentType.LEFT, indent: c.indentPt ? { left: tw(c.indentPt) } : undefined,
            spacing: { before: 0, after: 0 },
            children: c.image ? (c.image.png ? [new D.ImageRun({ type: 'png', data: png(c.image.png), transformation: { width: c.image.wPt / 0.75, height: c.image.hPt / 0.75 } })] : [])
                              : c.runs.map(run) })] })) })] });
    }
    // Explicit, even when empty: a section without its own header or footer inherits the previous one's.
    const zone = (Kind, z) => new Kind({ children: z ? [...z.rows.map(rowTable), tiny()] : [tiny()] });

    // One section per run of pages sharing size, margins and furniture; explicit page breaks inside.
    const sig = (z) => (z ? JSON.stringify(z.rows.map((r) => r.cells.map((c) => (c.image ? [c.image.wPt, c.image.hPt] : c.runs.map((x) => x.field || x.text || ''))))) : '');
    const groups = [];
    for (const pg of model.pages) {
      const key = JSON.stringify([pg.widthMM, pg.heightMM, pg.margins, pg.flattened, sig(pg.header), sig(pg.footer)]);
      const cur = groups[groups.length - 1];
      if (cur && cur.key === key) cur.pages.push(pg); else groups.push({ key, pages: [pg] });
    }
    const sections = groups.map(({ pages }) => {
      const pg = pages[0];
      return {
        properties: { page: { size: { width: mmTw(pg.widthMM), height: mmTw(pg.heightMM) },
          margin: { top: mmTw(pg.margins.top), left: mmTw(pg.margins.left), right: mmTw(pg.margins.right), bottom: mmTw(pg.margins.bottom),
                    header: pg.header ? mmTw(pg.header.distMM) : 0, footer: pg.footer ? mmTw(pg.footer.distMM) : 0 } } },
        headers: { default: zone(D.Header, pg.header) },
        footers: { default: zone(D.Footer, pg.footer) },
        children: pages.flatMap((p, i) => blocks(p.blocks, { firstPageBreak: i > 0, floating: layerImage(p) })),
      };
    });

    const bf = face(model.base.family, 400, false);
    used.add(bf.face);
    const doc = new D.Document({
      title: model.title, features: { updateFields: false }, hyphenation: { autoHyphenation: true },
      numbering: { config: [...bulletDefs.values()] },                 // bullets were registered while building sections
      styles: { default: { document: { run: { font: bf.face, size: Math.round(model.base.sizePt * 2), color: model.base.color, language: { value: model.lang } } } } },
      sections,
    });
    const zip = await JSZip.loadAsync(await D.Packer.toArrayBuffer(doc));

    /* ---- post-processing: things the library can't express ---- */
    // Fonts: all four slots per family (the library's own option writes Regular only).
    const fams = F.officeFamilies(fonts, used);
    let ft = await zip.file('word/fontTable.xml').async('string');
    let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    let n = 0, fontXml = '';
    const TAG = { regular: 'embedRegular', bold: 'embedBold', italic: 'embedItalic', boldItalic: 'embedBoldItalic' };
    for (const fam of fams) {
      let emb = '';
      for (const slot of ['regular', 'bold', 'italic', 'boldItalic']) {
        const f = fam.slots[slot];
        if (!f) continue;
        n++;
        const o = F.odttf(f.bytes);
        zip.file(`word/fonts/font${n}.odttf`, o.data);
        rels += `<Relationship Id="rIdF${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.odttf"/>`;
        emb += `<w:${TAG[slot]} r:id="rIdF${n}" w:fontKey="${o.key}"/>`;
      }
      const pan = fam.panose.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
      fontXml += `<w:font w:name="${fam.name}"><w:panose1 w:val="${pan}"/><w:charset w:val="00"/><w:family w:val="${fam.genre}"/><w:pitch w:val="variable"/>${emb}</w:font>`;
      ft = ft.replace(new RegExp(`<w:font w:name="${fam.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</w:font>`, 'g'), '');
    }
    if (!/xmlns:r=/.test(ft)) ft = ft.replace('<w:fonts ', '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    // The library writes a self-closing <w:fonts .../> when it has nothing of its own.
    ft = /<w:fonts[^>]*\/>\s*$/.test(ft) ? ft.replace(/<w:fonts([^>]*)\/>\s*$/, (m, a) => `<w:fonts${a}>${fontXml}</w:fonts>`) : ft.replace('</w:fonts>', fontXml + '</w:fonts>');
    zip.file('word/fontTable.xml', ft);
    zip.file('word/_rels/fontTable.xml.rels', rels + '</Relationships>');
    let ct = await zip.file('[Content_Types].xml').async('string');
    if (!ct.includes('Extension="odttf"')) ct = ct.replace('<Default ', '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default ');
    zip.file('[Content_Types].xml', ct);

    // No hyphenation on headings or on lines that never wrap. The library has no per-paragraph
    // option; schema order puts suppressAutoHyphens before <w:spacing>.
    let dx = await zip.file('word/document.xml').async('string');
    dx = dx.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (m, inner) => (!inner.includes('<w:keepLines/>') ? m
      : `<w:pPr>${inner.includes('<w:spacing') ? inner.replace('<w:spacing', '<w:suppressAutoHyphens/><w:spacing') : inner + '<w:suppressAutoHyphens/>'}</w:pPr>`));
    zip.file('word/document.xml', dx);

    // settings.xml, in schema order: embedTrueTypeFonts after the view/print group, and
    // autoHyphenation before evenAndOddHeaders (the library writes it after).
    let st = await zip.file('word/settings.xml').async('string');
    const EARLY = 'printFormsData|printFractionalCharacterWidth|printPostScriptOverText|displayBackgroundShape|doNotDisplayPageBoundaries|removeDateAndTime|removePersonalInformation|zoom|view|writeProtection';
    const lastEarly = st.match(new RegExp(`<w:(?:${EARLY})\\b[^>]*\\/>(?![\\s\\S]*<w:(?:${EARLY})\\b)`));
    st = lastEarly ? st.replace(lastEarly[0], lastEarly[0] + '<w:embedTrueTypeFonts/>') : st.replace(/<w:settings([^>]*)>/, '<w:settings$1><w:embedTrueTypeFonts/>');
    const ah = st.match(/<w:autoHyphenation[^>]*\/>/);
    if (ah && st.includes('<w:evenAndOddHeaders')) st = st.replace(ah[0], '').replace('<w:evenAndOddHeaders', ah[0] + '<w:evenAndOddHeaders');
    zip.file('word/settings.xml', st);

    return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), faces: [...used] };
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/export/docx.test.mjs`
Expected: 7 pass.

If "section without one says so explicitly" fails because the library omits empty footers, check `word/_rels/document.xml.rels` for two footer relationships and adjust only the assertion's file discovery, not the explicit-empty-footer behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/export/docx.js test/export/docx.test.mjs
git commit -m "Build a Word document from the layout model, one Word page per HTML page"
```

---

### Task 5: `pptx.js`, the model turned into a PowerPoint deck

**Files:**
- Create: `src/export/pptx.js`
- Test: `test/export/pptx.test.mjs`

**Interfaces:**
- **Consumes:** the `Slide` shape from Task 3, and `HepExport.fonts.{faceMapper, lineRatio, officeFamilies, eot}`.
- **Produces:** `HepExport.toPptx(model, fonts, { PptxGenJS, JSZip }) → Promise<{ bytes, faces }>`.
- **Internal extension points:**
  - `CAL` and `yShiftPt(sizePt, lineHeightPt, natural)`, which Task 8 recalibrates;
  - `glyphSplit(run, f)`, which returns `[run]` until Task 7.

- [ ] **Step 1: Write the failing tests `test/export/pptx.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HepExport, libs, bundledFonts } from './load.mjs';

const run = (text, o = {}) => ({ text, family: 'DM Sans', weight: 400, italic: false, sizePt: 16, color: '2C2C2C', spacingPt: 0, upper: false, ...o });
const para = (runs, o = {}) => ({ t: 'p', tag: 'p', runs, bullet: null, align: 'left', lineHeightPt: 26.4, spaceBeforePt: 0, spaceAfterPt: 0,
  indentLeftPt: 0, indentRightPt: 0, hangingPt: 0, noWrap: false, ...o });
const deck = { version: 1, kind: 'deck', pagination: 'fixed', lang: 'en-GB', title: 'Deck', warnings: [], slides: [{
  bg: 'EDF4ED', wPt: 1080, hPt: 607.5, items: [
    { t: 'shape', shape: 'roundRect', radiusPt: 6, fill: 'FFFFFF', alpha: 1, shadow: 'rgba(0, 0, 0, 0.06) 0px 2px 12px 0px', x: 40, y: 100, w: 400, h: 150 },
    { t: 'text', x: 54, y: 54, w: 900, h: 41, paras: [para([run('Heading', { sizePt: 36, weight: 700 })], { lineHeightPt: 41.4, noWrap: true })] },
    { t: 'text', x: 54, y: 184, w: 826, h: 57, paras: [para([run('Capture', { weight: 700 }), run(' — logged')],
      { bullet: { text: '→', family: 'DM Sans', weight: 600, italic: false, sizePt: 16, color: 'A5C869' }, hangingPt: 24 })] },
  ] }] };

async function build(m) {
  const out = await HepExport.toPptx(m, await bundledFonts(), libs);
  const zip = await libs.JSZip.loadAsync(out.bytes);
  return { out, zip, read: (n) => zip.file(n).async('string') };
}

test("slide size is the HTML slide's own, so point sizes carry over unchanged", async () => {
  assert.match(await (await build(deck)).read('ppt/presentation.xml'), /<p:sldSz cx="13716000" cy="7715250"/);
});

test('fonts are embedded as EOT in schema position', async () => {
  const { zip, read } = await build(deck);
  const pres = await read('ppt/presentation.xml');
  assert.match(pres, /embedTrueTypeFonts="1"/);
  assert.ok(pres.indexOf('<p:embeddedFontLst>') > pres.indexOf('<p:notesSz'), 'embeddedFontLst follows notesSz');
  assert.match(pres, /<p:embeddedFont><p:font typeface="DM Sans"[^>]*\/><p:regular r:id="[^"]+"\/><p:bold r:id="[^"]+"\/>/);
  assert.ok(Object.keys(zip.files).some((n) => /^ppt\/fonts\/font\d+\.fntdata$/.test(n)));
  assert.match(await read('[Content_Types].xml'), /Extension="fntdata" ContentType="application\/x-fontdata"/);
});

test('bullets keep their own colour and face', async () => {
  const s = await (await build(deck)).read('ppt/slides/slide1.xml');
  assert.match(s, /<a:buClr><a:srgbClr val="A5C869"\/><\/a:buClr><a:buSzPct val="100000"\/><a:buFont typeface="DM Sans SemiBold"\/><a:buChar/);
});

test('text is measured boxes with exact line spacing, no autofit and zero insets', async () => {
  const s = await (await build(deck)).read('ppt/slides/slide1.xml');
  assert.match(s, /<a:spcPts val="4140"\/>/);
  assert.match(s, /lIns="0" tIns="0" rIns="0" bIns="0"/);
  assert.ok(!/normAutofit/.test(s));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/export/pptx.test.mjs`
Expected: FAIL, `HepExport.toPptx is not a function`.

- [ ] **Step 3: Write `src/export/pptx.js`**

```js
/*
 * Layout model -> .pptx. Every slide is a canvas measured in points, which is how
 * PowerPoint works too: measured text boxes, native shapes where PowerPoint has one,
 * PNG only for decoration it can't draw. Google Slides imports all of this cleanly.
 */
(function (root) {
  'use strict';
  const X = (root.HepExport ||= {});

  // PowerPoint places the first line of an exact-spaced paragraph higher than CSS does.
  // Predicted shift (pt, PowerPoint minus HTML) = A·size + B·extra, where extra is the line
  // height minus the font's own. B depends on the sign of extra. Values from the spike;
  // re-measured in Task 8. A box's y is corrected by subtracting the shift.
  const CAL = { A: -0.077, Bneg: 0.02, Bpos: 0.85 };
  function yShiftPt(sizePt, lineHeightPt, natural) {
    const extra = lineHeightPt - natural * sizePt;
    return CAL.A * sizePt + (extra < 0 ? CAL.Bneg : CAL.Bpos) * extra;
  }

  X.toPptx = async function toPptx(model, fonts, { PptxGenJS, JSZip }) {
    const F = X.fonts;
    const face = F.faceMapper(fonts);
    const used = new Set();
    const IN = (pt) => pt / 72;
    const glyphSplit = (r) => [r];                              // Task 7 replaces this

    const pptx = new PptxGenJS();
    const s0 = model.slides[0];
    pptx.defineLayout({ name: 'HTML', width: IN(s0.wPt), height: IN(s0.hPt) });
    pptx.layout = 'HTML';
    pptx.title = model.title;

    function shadowOf(css) {
      const m = css && css.match(/rgba?\(([^)]+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
      if (!m) return undefined;
      const c = m[1].split(/[ ,]+/).map(Number), ox = +m[2], oy = +m[3], blur = +m[4];
      return { type: 'outer', color: c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''), opacity: c[3] ?? 1,
               blur: blur * 0.75, offset: Math.hypot(ox, oy) * 0.75, angle: (Math.atan2(oy, ox) * 180 / Math.PI + 360) % 360 };
    }
    const bulletStyles = new Map();
    function textRuns(paras) {
      const out = [];
      paras.forEach((p, pi) => {
        const opts = { align: p.align, paraSpaceBefore: Math.max(0, p.spaceBeforePt || 0), lineSpacing: p.lineHeightPt,
          ...(p.bullet ? { bullet: { code: p.bullet.text.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), indent: p.hangingPt } } : {}) };
        if (p.bullet) {
          const bf = face(p.bullet.family, p.bullet.weight, p.bullet.italic);
          used.add(bf.face);
          bulletStyles.set(p.bullet.text, { color: p.bullet.color, face: bf.face });
        }
        let softBreak = false;
        const runs = p.runs.filter((r) => r.text || r.br).flatMap((r) => (r.br ? [r] : glyphSplit(r, face(r.family, r.weight, r.italic))));
        runs.forEach((r, ri) => {
          if (r.br) { softBreak = true; return; }
          const f = face(r.family, r.weight, r.italic);
          const fontFace = r.glyphFace || f.face;
          used.add(fontFace);
          out.push({ text: r.text, options: { ...opts, fontFace, bold: f.bold, italic: f.italics, fontSize: r.sizePt, color: r.color,
            charSpacing: r.spacingPt || undefined, softBreakBefore: softBreak || undefined, breakLine: ri === runs.length - 1 && pi < paras.length - 1 } });
          softBreak = false;
        });
      });
      return out;
    }

    for (const s of model.slides) {
      const slide = pptx.addSlide();
      slide.background = { color: s.bg };
      for (const it of s.items) {
        const box = { x: IN(it.x), y: IN(it.y), w: IN(it.w), h: IN(it.h) };
        if (it.t === 'shape') {
          slide.addShape({ rect: pptx.ShapeType.rect, roundRect: pptx.ShapeType.roundRect, ellipse: pptx.ShapeType.ellipse }[it.shape], {
            ...box, fill: { color: it.fill, transparency: Math.round((1 - it.alpha) * 100) }, line: { type: 'none' },
            rectRadius: it.shape === 'roundRect' ? IN(it.radiusPt) : undefined, shadow: shadowOf(it.shadow) });
        } else if (it.t === 'image') {
          if (it.png) slide.addImage({ data: it.png.replace(/^data:/, ''), ...box });
        } else if (it.t === 'text') {
          const first = it.paras[0], main = first.runs.find((r) => r.text) || first.runs[0];
          const shift = main ? yShiftPt(main.sizePt, first.lineHeightPt, F.lineRatio(face(main.family, main.weight, main.italic).font)) : 0;
          const single = it.paras.length === 1 && first.noWrap;
          // Wrapped text gets 0.5% more width: PowerPoint's line breaker is marginally less generous
          // than Chrome's, and 2% was enough to pull a word up a line.
          slide.addText(textRuns(it.paras), { ...box, y: IN(it.y - shift), w: single ? box.w : box.w * 1.005,
            margin: 0, valign: 'top', wrap: !single, fit: 'none', isTextBox: true });
        }
      }
    }

    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'uint8array' }));

    // Bullet colour and face: pptxgenjs has no option for either.
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      let x = await zip.file(name).async('string');
      for (const [ch, st] of bulletStyles) {
        for (const c of [ch, '&#x' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ';']) {
          x = x.split(`<a:buSzPct val="100000"/><a:buChar char="${c}"/>`).join(
            `<a:buClr><a:srgbClr val="${st.color}"/></a:buClr><a:buSzPct val="100000"/><a:buFont typeface="${st.face}"/><a:buChar char="${c}"/>`);
        }
      }
      zip.file(name, x);
    }

    // Fonts as uncompressed EOT (.fntdata), which PowerPoint for Mac and Windows reads.
    const fams = F.officeFamilies(fonts, used);
    let pres = await zip.file('ppt/presentation.xml').async('string');
    let rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
    let n = 0, lst = '';
    for (const fam of fams) {
      let ent = `<p:embeddedFont><p:font typeface="${fam.name}" pitchFamily="${fam.genre === 'roman' ? 18 : 34}" charset="0"/>`;
      for (const slot of ['regular', 'bold', 'italic', 'boldItalic']) {
        const f = fam.slots[slot];
        if (!f) continue;
        n++;
        zip.file(`ppt/fonts/font${n}.fntdata`, F.eot(f));
        rels = rels.replace('</Relationships>', `<Relationship Id="rIdFnt${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.fntdata"/></Relationships>`);
        ent += `<p:${slot} r:id="rIdFnt${n}"/>`;
      }
      lst += ent + '</p:embeddedFont>';
    }
    // Never reorder <p:presentation>'s other children: pptxgenjs's own order is what PowerPoint accepts.
    pres = pres.replace(/\s*saveSubsetFonts="1"/, '').replace('<p:presentation ', '<p:presentation embedTrueTypeFonts="1" ');
    if (lst) pres = pres.replace(/(<p:notesSz[^>]*\/>)/, `$1<p:embeddedFontLst>${lst}</p:embeddedFontLst>`);
    zip.file('ppt/presentation.xml', pres);
    zip.file('ppt/_rels/presentation.xml.rels', rels);
    let ct = await zip.file('[Content_Types].xml').async('string');
    if (!ct.includes('Extension="fntdata"')) ct = ct.replace('<Default ', '<Default Extension="fntdata" ContentType="application/x-fontdata"/><Default ');
    zip.file('[Content_Types].xml', ct);

    return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), faces: [...used] };
  };
  X.toPptx.CAL = CAL;              // exposed for the Task 8 calibration
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/export/pptx.test.mjs`
Expected: 4 pass. If the `sldSz cy` value differs by rounding (7715250 is 8.4375 in × 914400), assert with a regex allowing ±1000 EMU, and note why in a comment.

- [ ] **Step 5: Commit**

```bash
git add src/export/pptx.js test/export/pptx.test.mjs
git commit -m "Build a PowerPoint deck from the layout model, with measured boxes and native shapes"
```

---

### Task 6: `index.js`, the whole pipeline, checked in real Word and PowerPoint

**Files:**
- Create: `src/export/index.js`
- Create (local only, not committed): `.spike/office-export/export_via_harness.py`

**Interfaces:**
- **Consumes:** `detectKind`, `extract`, `fonts.collect`, `toDocx`, `toPptx`.
- **Produces:** `HepExport.run(doc, deps) → Promise<{ kind: 'document'|'deck'|'unsupported', ext?: 'docx'|'pptx', mime?, bytes?: Uint8Array, reason?, warnings: string[] }>`.
- **`deps`:** `{ docx, PptxGenJS, JSZip, decompress, fetchBytes }`.

- [ ] **Step 1: Write `src/export/index.js`**

```js
/*
 * Export orchestration: detect, extract, collect the document's fonts, build, warn.
 * The host (editor or skill) supplies the libraries and a way to fetch bytes, which is
 * what lets identical files run in both places.
 */
(function (root) {
  'use strict';
  const X = (root.HepExport ||= {});
  // Faces Office already has; a document naming one of these needs nothing embedded.
  const CORE = new Set(['arial', 'helvetica', 'times new roman', 'times', 'georgia', 'calibri', 'cambria', 'courier new', 'verdana', 'sans-serif', 'serif', 'monospace']);
  const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

  X.run = async function run(doc, deps) {
    const k = X.detectKind(doc);
    if (k.kind === 'unsupported') return { kind: 'unsupported', reason: k.reason, warnings: [] };
    const model = await X.extract(doc);
    const { fonts, warnings } = await X.fonts.collect(doc, deps);
    const out = model.kind === 'deck' ? await X.toPptx(model, fonts, deps) : await X.toDocx(model, fonts, deps);
    for (const face of out.faces) {
      const f = fonts.find((x) => x.family === face);
      if (f && !X.fonts.embeddable(f)) warnings.push(`“${face}” doesn't allow embedding, so it was left out. Recipients need it installed to see it.`);
      else if (!f && !CORE.has(face.toLowerCase()) && !/ Glyphs$/.test(face)) warnings.push(`“${face}” isn't part of the document, so recipients see a substitute unless they have it installed.`);
    }
    const ext = model.kind === 'deck' ? 'pptx' : 'docx';
    return { kind: model.kind, ext, mime: MIME[ext], bytes: out.bytes, warnings: [...model.warnings, ...warnings] };
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Confirm the whole suite still passes**

Run: `npm test`
Expected: every test passes (the four fixture tests skip).

- [ ] **Step 3: Create the local runner `.spike/office-export/export_via_harness.py`**

```python
"""Local only. Export a file through the committed harness and write the result to disk.
usage: venv/bin/python export_via_harness.py <path under the repo root> <out file>"""
import sys, base64, threading, functools, http.server, socketserver, pathlib
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[2]
src, out = sys.argv[1], sys.argv[2]
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(REPO))
handler.log_message = lambda *a: None
srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1600, 'height': 1000})
    pg.on('console', lambda m: print('console:', m.text) if m.type in ('error', 'warning') else None)
    pg.goto(f'http://127.0.0.1:{port}/test/fixtures/export-harness.html')
    pg.wait_for_function('window.ready === true')
    r = pg.evaluate("""async (u) => { const res = await exportFixture(u);
        return res.bytes ? { ext: res.ext, warnings: res.warnings, b64: await toBase64(res.bytes) } : res; }""", '/' + src)
    b.close()
srv.shutdown()
if 'b64' not in r:
    sys.exit(f"not exported: {r}")
pathlib.Path(out).write_bytes(base64.b64decode(r['b64']))
print('wrote', out, 'warnings:', r['warnings'])
```

- [ ] **Step 4: Export both fixtures**

```bash
cd "/Users/lukeazzopardi/Claude Code/HTML Editor/.spike/office-export"
V=/private/tmp/claude-501/-Users-lukeazzopardi-Claude-Code-HTML-Editor/779bba67-d49a-4193-a09f-794eaa716650/scratchpad/spike/venv/bin/python
[ -x "$V" ] || { python3 -m venv venv && ./venv/bin/pip install -q playwright==1.58.0 fonttools pillow; V=./venv/bin/python; }
$V export_via_harness.py test/fixtures/export-doc.html out/plan-doc.docx
$V export_via_harness.py test/fixtures/export-deck.html out/plan-deck.pptx
```

Expected: `wrote out/plan-doc.docx warnings: []`, and the same for the deck.

- [ ] **Step 5: Render both in real Word and PowerPoint for Mac, and compare them with the HTML**

- **Word:** use the Word MCP (`open_document`, `export_pdf` to `out/plan-doc.word.pdf`, `close_document` with `save: false`).
- **PowerPoint:** the MCP's export silently writes nothing, so use AppleScript into its container:

```bash
OUTD=~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/spike; mkdir -p "$OUTD"; cp out/plan-deck.pptx "$OUTD/"
osascript -e "tell application \"Microsoft PowerPoint\"
  open POSIX file \"$OUTD/plan-deck.pptx\"
  delay 2
  save active presentation in POSIX file \"$OUTD/plan-deck.pdf\" as save as PDF
  close active presentation saving no
end tell" && cp "$OUTD/plan-deck.pdf" out/plan-deck.ppt.pdf
```

Then compare:

```bash
pdfinfo out/plan-doc.word.pdf | grep Pages       # expect 5
pdfinfo out/plan-deck.ppt.pdf | grep Pages       # expect 8
$V pdffontver.py out/plan-doc.word.pdf           # DM Sans SemiBold and Source Serif 4 at 4.004 (embedded)
rm -f out/c-*.png; pdftoppm -r 50 -png fixtures/export-trial-document.pdf out/c-h; pdftoppm -r 50 -png out/plan-doc.word.pdf out/c-w
$V montage.py out/plan-doc-cmp.png 5 out/c-h-{1,2,3,4,5}.png out/c-w-{1,2,3,4,5}.png
$V deckcmp.py out/plan-deck-cmp.png fixtures/export-trial-deck.pdf out/plan-deck.ppt.pdf
```

Read both PNGs and check that every page and slide matches the spike's approved v2 results:
- same page breaks and contents layout;
- callout, table and bullets correct;
- footer page numbers correct;
- slides aligned.

Record any difference as a failing check and fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/export/index.js
git commit -m "Wire the export pipeline together: detect, extract, embed fonts, build, warn"
```

---

### Task 7: Missing-glyph routing (the arrow fix), with a checkpoint

**Files:**
- Modify: `src/export/fonts.js` (add `renameFamily`, `isCore`, `glyphFaceName`)
- Modify: `src/export/docx.js` (replace `glyphFonts`)
- Modify: `src/export/pptx.js` (replace `glyphSplit`)
- Modify: `src/export/index.js` (add the renamed copies to the font list)
- Test: `test/export/glyphs.test.mjs`

**Interfaces:**
- **Produces:**
  - `HepExport.fonts.renameFamily(font, family) → FontInfo`: valid sfnt with rewritten name records and fixed checksums.
  - `HepExport.fonts.isCore(codePoint) → boolean`
  - `HepExport.fonts.glyphFaceName(face) → string`, which is `face + ' Glyphs'`.
  - `HepExport.glyphMode`: `'route'` (the default) or `'off'`. It is a global switch, so the checkpoint can compare both.
- **Word:** a run with non-core characters gets `font: { ascii: face, hAnsi: glyphFace, cs: glyphFace }`. Word takes symbols from the `hAnsi` font, and Google should read `ascii`.
- **PowerPoint:** a run is split into core and non-core segments, and the non-core segments get `glyphFace`.

- [ ] **Step 1: Write the failing tests `test/export/glyphs.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HepExport, libs, bundledFonts } from './load.mjs';

const sum = (b) => { const v = new DataView(b.buffer, b.byteOffset); let s = 0; for (let i = 0; i + 4 <= b.length; i += 4) s = (s + v.getUint32(i)) >>> 0; return s; };

test('a renamed copy is a valid font under the new family, with the same glyphs', async () => {
  const f = (await bundledFonts()).find((x) => x.family === 'DM Sans' && !x.bold && !x.italic);
  const g = HepExport.fonts.renameFamily(f, 'DM Sans Glyphs');
  assert.equal(g.family, 'DM Sans Glyphs');
  assert.equal(g.names[4], 'DM Sans Glyphs');
  assert.ok(g.cmap.has(0x2192));
  assert.equal(g.bytes.length % 4, 0);
  assert.equal(sum(g.bytes), 0xB1B0AFBA, 'whole-file checksum after checkSumAdjustment');
});

test('core characters stay on the real face; arrows do not', () => {
  const c = HepExport.fonts.isCore;
  for (const ch of 'Aa9 é£—’“”…€') assert.equal(c(ch.codePointAt(0)), true, ch);
  for (const ch of '→←↑↓✓') assert.equal(c(ch.codePointAt(0)), false, ch);
});

const run = (text, o = {}) => ({ text, family: 'DM Sans', weight: 400, italic: false, sizePt: 10.5, color: '2C2C2C', spacingPt: 0, upper: false, ...o });
const p = { t: 'p', tag: 'p', runs: [run('Content → pages')], bullet: null, align: 'left', lineHeightPt: 17.85, spaceBeforePt: 0, spaceAfterPt: 0, indentLeftPt: 0, indentRightPt: 0, hangingPt: 0, noWrap: false };

test('Word: arrows route through hAnsi to an embedded private copy, ascii stays DM Sans', async () => {
  const fonts = await HepExport.fonts.withGlyphFaces(await bundledFonts());
  const m = { version: 1, kind: 'document', pagination: 'fixed', lang: 'en-GB', title: 't', base: run(''), warnings: [],
    pages: [{ widthMM: 210, heightMM: 297, flattened: false, margins: { top: 22, left: 25, right: 25, bottom: 24 }, blocks: [p], header: null, footer: null, layer: null }] };
  const zip = await libs.JSZip.loadAsync((await HepExport.toDocx(m, fonts, libs)).bytes);
  const doc = await zip.file('word/document.xml').async('string');
  // docx 9.7.1 writes the attributes as ascii, cs, hAnsi.
  assert.match(doc, /<w:rFonts w:ascii="DM Sans" w:cs="DM Sans Glyphs" w:hAnsi="DM Sans Glyphs"\/>/);
  assert.match(await zip.file('word/fontTable.xml').async('string'), /<w:font w:name="DM Sans Glyphs">[\s\S]*?<w:embedRegular /);
});

test('PowerPoint: the arrow becomes its own run on the private face', async () => {
  const fonts = await HepExport.fonts.withGlyphFaces(await bundledFonts());
  const d = { version: 1, kind: 'deck', pagination: 'fixed', lang: 'en-GB', title: 't', warnings: [],
    slides: [{ bg: 'FFFFFF', wPt: 1080, hPt: 607.5, items: [{ t: 'text', x: 10, y: 10, w: 500, h: 30, paras: [{ ...p, lineHeightPt: 26 }] }] }] };
  const zip = await libs.JSZip.loadAsync((await HepExport.toPptx(d, fonts, libs)).bytes);
  const s = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(s, /<a:latin typeface="DM Sans Glyphs"[^>]*\/>[\s\S]*?<a:t>→<\/a:t>/);
  assert.match(s, /<a:t>Content <\/a:t>/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/export/glyphs.test.mjs`
Expected: FAIL, `renameFamily is not a function`.

- [ ] **Step 3: Add these functions to `src/export/fonts.js`**, before the `X.fonts = …` line, and add `renameFamily, isCore, glyphFaceName, withGlyphFaces` to that object.

```js
  /*
   * Missing-glyph routing. Office prefers its own cloud copy of a face over the embedded
   * one, and an older cloud copy can lack glyphs the document uses: Microsoft's DM Sans
   * has no arrows. Characters outside this core set are therefore routed to a privately
   * named copy of the same file ("DM Sans Glyphs"), which Office can only get from the file.
   */
  const CORE_EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2022, 0x20AC, 0x2122, 0x00A0]);
  const isCore = (c) => (c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || CORE_EXTRA.has(c);
  const glyphFaceName = (face) => `${face} Glyphs`;

  function checksum(b, off, len) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let s = 0;
    for (let i = off, end = off + ((len + 3) & ~3); i < end; i += 4) s = (s + v.getUint32(i)) >>> 0;
    return s;
  }
  function replaceTable(bytes, tag, data) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint16(4), dir = [];
    for (let i = 0; i < n; i++) {
      const o = 12 + 16 * i, t = String.fromCharCode(...bytes.subarray(o, o + 4));
      dir.push({ t, data: t === tag ? data : bytes.subarray(dv.getUint32(o + 8), dv.getUint32(o + 8) + dv.getUint32(o + 12)) });
    }
    const pad = (x) => (x + 3) & ~3;
    const out = new Uint8Array(12 + 16 * n + dir.reduce((s, d) => s + pad(d.data.length), 0));
    const ov = new DataView(out.buffer);
    out.set(bytes.subarray(0, 12));
    let off = 12 + 16 * n, headOff = -1;
    dir.forEach((d, i) => {
      const o = 12 + 16 * i;
      for (let k = 0; k < 4; k++) out[o + k] = d.t.charCodeAt(k);
      out.set(d.data, off);
      if (d.t === 'head') { headOff = off; ov.setUint32(off + 8, 0); }      // checksummed with the adjustment zeroed
      ov.setUint32(o + 4, checksum(out, off, d.data.length)); ov.setUint32(o + 8, off); ov.setUint32(o + 12, d.data.length);
      off += pad(d.data.length);
    });
    if (headOff >= 0) ov.setUint32(headOff + 8, (0xB1B0AFBA - checksum(out, 0, out.length)) >>> 0);
    return out;
  }
  function renameFamily(f, family) {
    const sub = f.names[2] || 'Regular';
    const ps = `${family}-${sub}`.replace(/[^A-Za-z0-9-]/g, '');
    const recs = { 1: family, 2: sub, 3: `${ps};export`, 4: sub === 'Regular' ? family : `${family} ${sub}`, 5: f.names[5] || 'Version 1.000', 6: ps };
    const entries = [];
    for (const [id, s] of Object.entries(recs)) {
      entries.push({ pid: 1, eid: 0, lid: 0, id: +id, bytes: Uint8Array.from([...s].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63))) });
      const u = new Uint8Array(s.length * 2);
      for (let i = 0; i < s.length; i++) { u[2 * i] = s.charCodeAt(i) >> 8; u[2 * i + 1] = s.charCodeAt(i) & 255; }
      entries.push({ pid: 3, eid: 1, lid: 0x409, id: +id, bytes: u });
    }
    entries.sort((a, b) => a.pid - b.pid || a.eid - b.eid || a.lid - b.lid || a.id - b.id);
    const head = 6 + 12 * entries.length;
    const name = new Uint8Array(head + entries.reduce((s, e) => s + e.bytes.length, 0));
    const nv = new DataView(name.buffer);
    nv.setUint16(2, entries.length); nv.setUint16(4, head);
    let off = 0;
    entries.forEach((e, i) => {
      const o = 6 + 12 * i;
      nv.setUint16(o, e.pid); nv.setUint16(o + 2, e.eid); nv.setUint16(o + 4, e.lid); nv.setUint16(o + 6, e.id);
      nv.setUint16(o + 8, e.bytes.length); nv.setUint16(o + 10, off);
      name.set(e.bytes, head + off);
      off += e.bytes.length;
    });
    return { ...readFont(replaceTable(f.bytes, 'name', name)), cssFamily: `${f.cssFamily} Glyphs`, cssWeight: f.cssWeight, cssItalic: f.cssItalic, glyphOf: f.family };
  }
  // The font list plus one private copy per face, which the builders use for routed characters.
  async function withGlyphFaces(fonts) {
    return [...fonts, ...fonts.filter(embeddable).map((f) => renameFamily(f, glyphFaceName(f.family)))];
  }
```

- [ ] **Step 4: Replace the extension points in the builders**

In `src/export/docx.js`, replace `const glyphFonts = () => null;                              // Task 7 replaces this` with:

```js
    // Characters outside the core set go to the private copy through hAnsi/cs: Word takes symbols
    // from hAnsi, and Google Docs reads ascii, so each application gets the face it can render.
    const glyphFonts = (r, f) => {
      if ((X.glyphMode || 'route') === 'off' || !f.font || r.text == null) return null;
      const g = X.fonts.glyphFaceName(f.face);
      if (![...r.text].some((ch) => !X.fonts.isCore(ch.codePointAt(0)) && f.font.cmap.has(ch.codePointAt(0)))) return null;
      if (!fonts.some((x) => x.family === g)) return null;
      used.add(g);
      return { ascii: f.face, hAnsi: g, cs: g };
    };
```

In `src/export/pptx.js`, replace `const glyphSplit = (r) => [r];                              // Task 7 replaces this` with:

```js
    // PowerPoint has no hAnsi slot for Latin text, so routed characters become their own runs.
    const glyphSplit = (r, f) => {
      if ((X.glyphMode || 'route') === 'off' || !f.font) return [r];
      const g = X.fonts.glyphFaceName(f.face);
      if (!fonts.some((x) => x.family === g)) return [r];
      const parts = [];
      for (const ch of r.text) {
        const routed = !X.fonts.isCore(ch.codePointAt(0)) && f.font.cmap.has(ch.codePointAt(0));
        const last = parts[parts.length - 1];
        if (last && !!last.glyphFace === routed) last.text += ch;
        else parts.push({ ...r, text: ch, glyphFace: routed ? g : undefined });
      }
      return parts;
    };
```

In `src/export/index.js`, change the font collection line to:

```js
    const collected = await X.fonts.collect(doc, deps);
    const warnings = collected.warnings;
    const fonts = await X.fonts.withGlyphFaces(collected.fonts);
```

Also replace the old `const { fonts, warnings } = …` line.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test`
Expected: all pass, including 4 new glyph tests.

- [ ] **Step 6: Checkpoint, part 1: Office on this Mac**

Re-run Task 6 steps 4–5. Both fixtures contain arrows: document page 3's bullets are SemiBold, and the deck's slide 1 subtitle arrow is Regular.

Then check:
- `$V pdffontver.py out/plan-deck.ppt.pdf` lists a `DMSans…Glyphs` (or similar) face at `fontRevision 4.004`, and **no `TimesNewRoman`**.
- Zoom slide 1 and confirm the subtitle arrow has the same shape as in the HTML PDF.
- Do the same for the Word document. Add a regular-weight inline arrow to a copy of the fixture if needed (`Content → pages` in a body paragraph), to prove the Word path.

If Word still shows Times for the arrow, `hAnsi` is not the slot Word uses for U+2192. Switch the Word path to the PowerPoint approach (run splitting) and re-test.

- [ ] **Step 7: Checkpoint, part 2: Luke checks Google**

This one is Luke's. Send him `out/plan-doc.docx` and `out/plan-deck.pptx`, built with the default `route` mode, and ask him to open each in Google Docs and Google Slides and look at the arrows: document page 3 and deck slides 1 and 3. Then record the decision in `SNAGS.md`:

- **Arrows correct in Google:** keep `route`.
- **Arrows wrong in Google** (a fallback shape, or a "DM Sans Glyphs" font name visible): Luke chooses. Either keep `route`, so arrows are correct in Office, or set `X.glyphMode = 'off'` as the default in `index.js`, so arrows are correct in Google. Implement that one-line default either way.

- [ ] **Step 8: Commit**

```bash
git add src/export/fonts.js src/export/docx.js src/export/pptx.js src/export/index.js test/export/glyphs.test.mjs SNAGS.md
git commit -m "Route characters an older cloud font lacks to a private embedded copy"
```

---

### Task 8: Calibrate PowerPoint's vertical text placement

**Files:**
- Modify: `src/export/pptx.js` (`CAL` constants, and the comment with the measurement date)
- Create (local): `.spike/office-export/calibration-deck.html`, `.spike/office-export/calibrate.py`

**Interfaces:** the output is the three constants `CAL.A`, `CAL.Bneg` and `CAL.Bpos`. Their meaning is unchanged.

- [ ] **Step 1: Build a calibration deck**

Build it from `test/fixtures/export-deck.html` by keeping one `.slide-content-light` slide and replacing its `.slide-body` with 20 absolutely positioned paragraphs. That is the cross product of sizes 11, 14, 16, 20, 24, 36, 48 and 64 pt with line heights 1.0, 1.15, 1.3, 1.5 and 1.7 (8 × 5 = 40, split across two slides). Each paragraph reads `Hxg <size>/<lh>`. Save it as `.spike/office-export/calibration-deck.html`.

```bash
cd "/Users/lukeazzopardi/Claude Code/HTML Editor/.spike/office-export"
node - <<'EOF'
const fs = require('fs');
let s = fs.readFileSync('../../test/fixtures/export-deck.html', 'utf8').replace(/\.\.\/\.\.\/assets/g, '../../assets');
const start = s.indexOf('<div id="stage">'), end = s.indexOf('</div><!-- /#stage -->');
const sizes = [11, 14, 16, 20, 24, 36, 48, 64], lhs = [1.0, 1.15, 1.3, 1.5, 1.7];
const cells = sizes.flatMap((sz) => lhs.map((lh) => [sz, lh]));
const slide = (cs) => `<section class="slide slide-content-light"><div class="slide-body" style="position:relative;height:100%;max-width:none">`
  + cs.map(([sz, lh], i) => `<p style="position:absolute;margin:0;left:${40 + (i % 5) * 270}px;top:${20 + Math.floor(i / 5) * 190}px;font-size:${sz}pt;line-height:${lh}">Hxg ${sz}/${lh}</p>`).join('')
  + `</div></section>`;
s = s.slice(0, start) + '<div id="stage">' + slide(cells.slice(0, 20)) + slide(cells.slice(20)) + s.slice(end);
fs.writeFileSync('calibration-deck.html', s);
EOF
```

- [ ] **Step 2: Export it, render it in PowerPoint, and measure every word's top in both PDFs**

Export through the harness (copy the file into `test/fixtures/` temporarily, since the harness serves the repo; delete it afterwards). Render in PowerPoint as in Task 6 step 5, with `CAL` temporarily set to `{ A: 0, Bneg: 0, Bpos: 0 }`, and print the reference PDF with Chrome.

Then run `calibrate.py`:

```python
"""Local only. Fit PowerPoint's vertical offset from two PDFs of the calibration deck."""
import re, subprocess, sys
def words(pdf):
    subprocess.run(['pdftotext', '-bbox', pdf, '/tmp/cal.html'], check=True)
    s = open('/tmp/cal.html').read()
    out = {}
    for page, body in enumerate(re.split(r'<page ', s)[1:]):
        toks = re.findall(r'yMin="([\d.]+)"[^>]*>([^<]+)<', body)
        for i, (y, w) in enumerate(toks):
            if w == 'Hxg' and i + 1 < len(toks): out[(page, toks[i + 1][1])] = float(y)
    return out
html, ppt = words(sys.argv[1]), words(sys.argv[2])
rows = []
for key, y in html.items():
    if key in ppt:
        sz, lh = map(float, key[1].split('/'))
        rows.append((sz, lh * sz, ppt[key] - y))
NAT = float(sys.argv[3])            # the font's (winAscent+winDescent)/upm, printed by fonts.lineRatio
def fit(sel):
    pts = [(sz, lh - NAT * sz, d) for sz, lh, d in rows if sel(lh - NAT * sz)]
    # least squares for d = A*sz + B*extra
    sxx = sum(a*a for a,_,_ in pts); sxy = sum(a*b for a,b,_ in pts); syy = sum(b*b for _,b,_ in pts)
    sxd = sum(a*d for a,_,d in pts); syd = sum(b*d for _,b,d in pts)
    det = sxx*syy - sxy*sxy
    return ((sxd*syy - syd*sxy)/det, (sxx*syd - sxy*sxd)/det, len(pts))
print('extra<0:', fit(lambda e: e < 0))
print('extra>=0:', fit(lambda e: e >= 0))
for sz, lh, d in sorted(rows): print(f'{sz:5} {lh:6.1f} {d:+.2f}')
```

Run: `$V calibrate.py cal.html.pdf cal.ppt.pdf 1.322`. Here `1.322` is DM Sans 4.004's `(1012 + 310) / 1000`; confirm it with `HepExport.fonts.lineRatio`.

Expected: two fits, each printed as `(A, B, n)`.

- [ ] **Step 3: Set `CAL` from the fits**

Use the average `A` of the two fits, and each fit's own `B`. Update the comment above `CAL` with "measured 2026-09-DD against PowerPoint for Mac <version>".

Re-export the calibration deck with the new values, re-render and re-run `calibrate.py`. Every residual should now be within ±1 pt. If it isn't, report the worst rows. Don't silently widen the tolerance.

- [ ] **Step 4: Confirm the fixture deck still passes Task 6 step 5, then commit**

```bash
git add src/export/pptx.js
git commit -m "Calibrate PowerPoint's vertical text placement against measurements"
```

---

### Task 9: The editor's Export button

**Files:**
- Modify: `index.html`: the toolbar (near line 718), the classic script tags (before line 803), `save()` (line 2605) to use `buildHtml()`, `wire()` (line 1095) to call `updateExportButton(doc)`, and `window.__hep` (line 2684)
- No new unit tests. Verification is in the browser, as for every other UI change in this repo.

**Interfaces:**
- **Consumes:** `HepExport.detectKind`, `HepExport.run` (Task 6); the editor's own `restoreBrandFonts(doc)`, `cards(doc)`, `measurePage(el)`, `toast(msg, bad)`, `fileName`, `scan`, `edits`, `deletions`, `comments`, `persistable()`, `applyEdits`, `writeReview`.
- **Produces:**
  - `buildHtml() → { html, changed }`, now used by `save()`;
  - `window.__hep.exportModel() → Promise<Model>`;
  - `window.__hep.export() → Promise<{ kind, ext, bytes: number, warnings, leaks: string[], text: string }>`.

- [ ] **Step 1: Add the button and the classic scripts**

In the toolbar, after `<button id="open">Open…</button>`:

```html
  <button id="export" hidden>Export</button>
```

Immediately before `<script type="module">`:

```html
<!-- Export: small, always loaded. The libraries it needs (vendor/) load on first export only. -->
<script src="src/export/fonts.js" defer></script>
<script src="src/export/extract.js" defer></script>
<script src="src/export/docx.js" defer></script>
<script src="src/export/pptx.js" defer></script>
<script src="src/export/index.js" defer></script>
```

- [ ] **Step 2: Factor `buildHtml()` out of `save()`**

Add this above `async function save()`:

```js
// The bytes Save writes. Export renders exactly these, so an export always matches what saving would produce.
function buildHtml() {
  const { html, changed } = applyEdits(
    scan,
    [...edits].map(([index, text]) => ({ index, text })),
    deletions.map((d) => d.id),
  );
  // The review block goes in afterwards: it lives outside every text run, so it
  // cannot disturb the offsets applyEdits just used.
  return { html: writeReview(html, persistable(comments)), changed };
}
```

In `save()`, replace the `try { ({ html, changed } = applyEdits(…)); html = writeReview(…); } catch …` block's body with `({ html, changed } = buildHtml());`, keeping its `catch` as it is.

- [ ] **Step 3: Add the export functions**

Add these after `savedSummary()`:

```js
/* ------------------------------------------------------------------ export */

let exportDeps = null;
async function loadExportDeps() {
  if (exportDeps) return exportDeps;
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
  await load('vendor/jszip.min.js');
  await load('vendor/docx.iife.js');
  await load('vendor/pptxgen.bundle.js');
  const { default: decompress } = await import('./vendor/woff2-decompress.js');
  exportDeps = {
    docx: window.docx, PptxGenJS: window.PptxGenJS, JSZip: window.JSZip, decompress,
    fetchBytes: (u) => fetch(new URL(u, location.href)).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${u}`);
      return r.arrayBuffer();
    }),
  };
  return exportDeps;
}

/*
 * Export reads a fresh render of the bytes Save would write, never the live editing
 * frame, so none of the editor's instrumentation, highlights or pending-deletion
 * hiding can reach an exported file (invariant 8). The frame must be really laid
 * out: display:none or a zero-size frame would leave nothing to measure.
 */
function renderForExport(html) {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;height:1000px;border:0';
    f.onload = async () => {
      try {
        const doc = f.contentDocument;
        await restoreBrandFonts(doc);                 // the same faces and logos the preview shows
        await doc.fonts.ready;
        await new Promise((r) => setTimeout(r, 150)); // the templates number their pages after fonts load
        resolve({ frame: f, doc });
      } catch (err) {
        f.remove();
        reject(err);
      }
    };
    f.srcdoc = html;
    document.body.append(f);
  });
}

// Pages Word may push onto an extra page: already spilling, or under 3mm spare.
function exportRiskPages() {
  const c = cards(frame.contentDocument);
  if (!c || c.kind !== 'page') return [];
  return c.els.map((el, i) => ({ n: i + 1, ...measurePage(el) })).filter((p) => p.spill > 1 || (p.mm != null && p.mm < 3));
}

async function saveExport(res) {
  const name = `${fileName.replace(/\.html?$/i, '')}.${res.ext}`;
  const blob = new Blob([res.bytes], { type: res.mime });
  if ('showSaveFilePicker' in window) {
    let h;
    try {
      h = await window.showSaveFilePicker({ suggestedName: name,
        types: [{ description: res.ext === 'docx' ? 'Word document' : 'PowerPoint presentation', accept: { [res.mime]: [`.${res.ext}`] } }] });
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    return h.name;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return name;
}

async function exportDocument() {
  if (!scan) return;
  const kind = HepExport.detectKind(frame.contentDocument);
  if (kind.kind === 'unsupported') { toast(kind.reason, true); return; }

  const risky = exportRiskPages();
  if (risky.length && !confirm(
    `${risky.length === 1 ? 'Page' : 'Pages'} ${risky.map((p) => p.n).join(', ')} ${risky.length === 1 ? 'is' : 'are'} full to the edge.\n\n`
    + 'Word may push the last line onto an extra page. Export anyway?'
  )) return;

  const btn = $('export');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  let rendered = null;
  try {
    const deps = await loadExportDeps();
    rendered = await renderForExport(buildHtml().html);
    const res = await HepExport.run(rendered.doc, deps);
    if (!res.bytes) { toast(res.reason, true); return; }
    const saved = await saveExport(res);
    if (!saved) return;
    toast(res.warnings.length ? `Exported ${saved}. ${res.warnings.join(' ')}` : `Exported ${saved}. The HTML itself is unchanged.`, res.warnings.length > 0);
  } catch (err) {
    console.error('Export failed:', err);
    toast(`Export failed — ${err.message}`, true);
  } finally {
    if (rendered) rendered.frame.remove();
    btn.disabled = false;
    btn.textContent = label;
  }
}

function updateExportButton(doc) {
  const k = HepExport.detectKind(doc);
  const b = $('export');
  b.hidden = false;
  b.textContent = k.kind === 'deck' ? 'Export to PowerPoint' : 'Export to Word';
  b.title = k.kind === 'unsupported' ? k.reason
    : `Save a copy for ${k.kind === 'deck' ? 'PowerPoint and Google Slides' : 'Word and Google Docs'}, with your unsaved edits. The HTML itself is not changed.`;
}
```

Next to `$('save').onclick = save;`, add:

```js
$('export').onclick = exportDocument;
```

At the end of `wire(doc)`, after `reportReadiness(matched, skipped);`, add:

```js
  updateExportButton(doc);
```

- [ ] **Step 4: Add the test hooks to `window.__hep`**

Add these next to `build:`:

```js
  exportModel: async () => {
    const r = await renderForExport(buildHtml().html);
    try { return await HepExport.extract(r.doc); } finally { r.frame.remove(); }
  },
  // Invariant 8's check: nothing of the editor's may appear anywhere in the exported package.
  export: async () => {
    const deps = await loadExportDeps();
    const r = await renderForExport(buildHtml().html);
    try {
      const res = await HepExport.run(r.doc, deps);
      if (!res.bytes) return res;
      const zip = await deps.JSZip.loadAsync(res.bytes);
      const leaks = [];
      let text = '';
      for (const n of Object.keys(zip.files)) {
        if (!/\.(xml|rels)$/.test(n)) continue;
        const x = await zip.file(n).async('string');
        if (/data-hep|contenteditable|spellcheck=|hep-highlight|hep-font-substitutes|data-hep-logo/.test(x)) leaks.push(n);
        text += x.replace(/<[^>]+>/g, ' ');
      }
      return { kind: res.kind, ext: res.ext, bytes: res.bytes.length, warnings: res.warnings, leaks, text };
    } finally { r.frame.remove(); }
  },
```

- [ ] **Step 5: Verify in the browser**

Start `preview_start({ name: 'editor' })` and open `http://localhost:8765/index.html?v=<new N>`. Confirm the new code is live by checking that `typeof window.__hep.export === 'function'`. Then, via `javascript_tool`:

```js
const f = new File([await (await fetch('/test/fixtures/export-doc.html')).text()], 'export-doc.html', { type: 'text/html' });
await __hep.load(f); await new Promise((r) => setTimeout(r, 1500));
__hep.type(0, 'Edited title');
const r = await __hep.export();
({ file: __hep.state().fileName, button: document.getElementById('export').textContent, kind: r.kind, leaks: r.leaks,
   hasEdit: r.text.includes('Edited title'), warnings: r.warnings })
```

Expected: `file: 'export-doc.html'`, `button: 'Export to Word'`, `kind: 'document'`, `leaks: []`, `hasEdit: true`, `warnings: []`.

Reload with a new `?v=`, then repeat with `export-deck.html`. Expected: `button: 'Export to PowerPoint'`, `kind: 'deck'`, `leaks: []`.

Then check the real button:

1. Click **Export to Word** (`computer` → `left_click` on `find('Export to Word')`).
2. A save dialog appears. **Cancel it**, since the picker is native and can't be driven. Confirm that no error toast appears and the button returns to its label.
3. Load a flowing test document (any `.html` without `.page`, for example a copy of `README`-style HTML in `.hep-test/`). Click Export and confirm the toast says flowing documents aren't supported yet.
4. Take a screenshot of the toolbar with the button, as proof.

- [ ] **Step 6: Run the tests again and commit**

Run: `npm test` (all pass).

```bash
git add index.html
git commit -m "Add Export to Word / PowerPoint to the editor, from a fresh render of what Save would write"
```

---

### Task 10: Real documents, documentation and release

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `SNAGS.md`, `CHANGELOG.md`

**Step 1: Collect real documents**

Ask Luke for:
- two recent Switch A4 documents made with skill v1.4 (fixed pages);
- one Switch deck;
- documents from the second design system, including the one that already carries a review block. Their locations are in Claude's private project memory, not in this repo.

Copy them into `.hep-test/`, which holds `*.html` and is git-ignored.

**Step 2: Export each one through the editor's `__hep.export()`, then check it in Word and PowerPoint**

Use the local runner or the real button. Render each in Word or PowerPoint as in Task 6 step 5, and compare it with its PDF page by page. Record every difference in `SNAGS.md`. Fix any real defects, adding a unit test for each where the model allows. A new document family has found a bug every time, so expect at least one.

**Step 3: Update the docs**

- **`CLAUDE.md`:**
  - Add **invariant 8**, word for word from the spec's "Editor integration".
  - Add a new **"## Exporting to Word and PowerPoint"** section covering:
    - the pipeline and files;
    - the layout model as the contract, and the `pagination` hook for flowing documents;
    - every trap from the spec's "What the spike established", each with its reason;
    - the vendoring and upgrade rule;
    - the glyph routing decision from Task 7;
    - the calibration date from Task 8;
    - how to run the local Word/PowerPoint checks.
  - Update the test count in "## Testing".
- **`README.md`:** a short user-facing section. It covers what export does, that the HTML is untouched, where fonts come from, Office for the web ignoring embedded fonts (recipients editing there should install the fonts), and no dots on the contents page in Google Docs.
- **`SNAGS.md`:**
  - Add the spike's findings under "Fixed" / "Known limitations": Google exact spacing, cloud DM Sans, arrows, leader dots, PowerPoint vertical offset.
  - Remove anything this work closes from "Proposed upgrades".
- **`CHANGELOG.md`:** a dated entry listing the commits.

**Step 4: Pre-commit name check, run the tests, and commit**

```bash
npm test
git diff --cached --stat
git add CLAUDE.md README.md SNAGS.md CHANGELOG.md
git diff --cached | grep -niE "<private name list>" && echo "STOP: a private name is staged" || git commit -m "Document export: invariant 8, the traps behind each rule, and the findings"
```

**Step 5: Push, only with Luke's OK**

Ask Luke. On yes, run `git push origin main`, then poll GitHub Pages until the build's `commit` matches `HEAD`:

```bash
gh api repos/lukeno23/switch-html-text-editor/pages/builds/latest --jq '.commit,.status'
```

Then do a final check against the live URL: export the fixture from `https://lukeno23.github.io/switch-html-text-editor/` in the in-app browser, and confirm `vendor/` loads (no 404s in `read_network_requests`).

**Step 6: Hand over for the next plan**

Tell Luke the editor export is live, and that the flowing-documents plan is next. It goes into the model at `pagination`, with `walk()` reused as is.

---

## Self-review

**Spec coverage.** Each part of the spec, and the task that delivers it:

| Spec section | Delivered by |
|---|---|
| Scope, fixed pages and decks (and unsupported flowing documents) | Tasks 3, 9 |
| Architecture and components | Tasks 1–6 |
| Model | Task 3 |
| Document mapping rules | Tasks 3, 4 |
| Deck mapping rules | Tasks 3, 5, 8 |
| Fonts, including permission | Task 2; warnings in Task 6 |
| Missing-glyph routing and its checkpoint | Task 7 |
| Editor integration and invariant 8 | Task 9 |
| Unit tests | Tasks 1, 2, 4, 5, 7 |
| Fidelity checks | Tasks 6, 10 |
| Google pass | Task 7 step 7 (arrows) and Task 10 (Luke checks real exports in Google before the skill release in plan 3) |
| Documentation | Task 10 |

Spec items deliberately not in this plan:
- **Skill integration and the v1.5 release** are plan 3.
- **The Team Guide line** ships with the skills, in plan 3.

**Type consistency.** These names are used identically across tasks:
- `HepExport.run(doc, deps)` and `deps = { docx, PptxGenJS, JSZip, decompress, fetchBytes }`;
- builders return `{ bytes, faces }`;
- `FontInfo.cmap`, `glyphFaceName` and `withGlyphFaces`;
- `Page.header` / `Page.footer` as `{ distMM, rows }`;
- `Cell.span`.
