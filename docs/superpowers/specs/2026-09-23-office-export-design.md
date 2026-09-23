# Export to Word and PowerPoint: design

*23 September 2026. Approved in conversation. Built on the feasibility spike of the
same date, whose code and findings are kept locally and are not part of the repository.*

## Goal

Turn a document made by either document skill into a file that clients can open,
edit and comment on outside Google Workspace:

- a fixed-page A4 document becomes **.docx**;
- a 16:9 deck becomes **.pptx**.

The file must look as close to the HTML and PDF as the destination allows, and it must
survive being opened in Word and PowerPoint (desktop and web) and imported into Google
Docs and Google Slides.

The same export runs from the editor, so no Claude round-trip is needed, and from
both skills, so Claude can deliver it. Both routes use identical code and give
identical output.

Export is one-way. The HTML stays the master, and nothing done in Word or PowerPoint
comes back to it.

## Scope

**In:**
- Fixed-page documents: `.page` cards, recognised by `looksLikeCards()`.
- Decks: `.slide`.
- Both design systems. The exporter reads the conventions they share (`.page-body`,
  `.slide`, `.slide-body`, `.bleed`) and the document's own fonts. It carries no
  brand knowledge.

**Out, for now:**
- **Flowing documents** that rely on `@page` margins and Chromium's print pagination.
  The editor explains why export is unavailable for them. They need Word to paginate
  on its own, which is a separate design.
- **Round-tripping** edits from Word or PowerPoint back to HTML.
- **Review comments.** The review block is an HTML comment and is not exported.

## What the spike established

These are facts the design depends on. Each was measured, not assumed.

**Pagination and layout**
- **Word matches the PDF page for page** given four things: an explicit page break
  per HTML page, spacing measured from real geometry, native styles, and callouts,
  columns and numbered items as borderless or bordered tables.
- **Google Docs misreads exact line spacing as a multiple.** 17.85 pt became about
  1.5× and a 38 pt heading about 3.2×. Only proportional spacing (`lineRule="auto"`,
  relative to the font's own line height) survives. Word paginates identically with
  it.
- **Word overlaps space-after with the next paragraph's space-before.** All
  inter-block space is therefore carried on space-before.
- **Word measures tab stops from the text column's left edge**, not from the
  paragraph's indent.
- **Google Docs cannot draw tab-leader dots.** Contents rows show aligned page
  numbers and no dots there, which is accepted.

**PowerPoint**
- **Horizontal placement is exact.** Vertical placement runs 1–5 pt high, varying
  with size and line height, and needs calibrating.
- **Wrapped text boxes need 0.5% extra width.** 2% changed Chrome's line breaks.
- **Google Slides imports measured text boxes, native shapes and PNG decoration
  cleanly.**

**Fonts**
- **Embedding works in Word and PowerPoint for Mac.** Word takes obfuscated TTF with
  all four slots written by hand, because the `docx` library writes only Regular.
  PowerPoint takes uncompressed EOT, ported from LibreOffice's `EOTConverter`.
- **Microsoft 365 serves DM Sans as a cloud font, and Office prefers it to the
  embedded copy.** The cloud copy is version 1.200, about 0.4% narrower than the
  kit's 4.004, and **has no arrow glyphs (→ ← ↑ ↓)**.
  - Weights that are not cloud fonts (SemiBold, Source Serif 4) render from the
    embedded copy.
  - The second design system's sans is also a cloud font, at the same version as its
    kit.
- **Exact weights (Medium, SemiBold) survived Google Docs and Google Slides**, so
  the portable Regular/Bold mapping is not needed.

## Architecture

```
            ┌───────────────── rendered document (any host) ─────────────────┐
HTML bytes →│ extract.js ── model (JSON) ──┬─→ docx.js ─→ .docx bytes        │
            │ fonts.js   ── font files  ───┴─→ pptx.js ─→ .pptx bytes        │
            └─────────────────────────────────────────────────────────────────┘
   host: editor (offscreen iframe)       or   skill (Playwright Chromium)
```

### Components

All components are plain classic scripts that attach to `window.HepExport`, with no
bundler and no build step. Everything except `extract.js` is DOM-free and runs under
Node for tests.

| File | Responsibility | Depends on |
|---|---|---|
| `src/export/extract.js` | `HepExport.extract(doc)` returns the **layout model**. It reads the rendered DOM only: geometry, computed styles, text runs. It rasterises decoration (SVG built from boxes, radii, gradients and inline SVG, drawn through a canvas). It fetches nothing. | a rendered `Document` |
| `src/export/fonts.js` | `collect(doc, {fetchBytes, decompress})` returns the document's font files, from `@font-face` data URLs or same-origin URLs, so the editor's lent fonts count. Also: sfnt table reader, face mapper (CSS family/weight/style to Office face and slot), `odttf()`, `eot()`, and the missing-glyph plan. | a WOFF2 decoder |
| `src/export/docx.js` | `toDocx(model, fonts, {docx, JSZip})` returns `Uint8Array`, including all post-processing: font embedding, schema-order fixes, hyphenation suppression. | `docx`, `JSZip` |
| `src/export/pptx.js` | `toPptx(model, fonts, {PptxGenJS, JSZip})` returns `Uint8Array`, including post-processing: bullet colour and face, font embedding. | `pptxgenjs`, `JSZip` |
| `src/export/index.js` | `HepExport.run(doc, deps)` detects the kind (deck, paged document or unsupported), orchestrates, and returns `{ kind, ext, bytes, warnings }`. | the above |
| `vendor/` | Pinned third-party files: `docx.iife.js` (9.7.1), `pptxgen.bundle.js` (4.0.1), `jszip.min.js` (3.10.2), `woff2-decompress.js` (woff2-encoder 2.0.0, ES module with its WebAssembly inline). About 2 MB, loaded only on first export. Each has a `VERSIONS` entry with source URL, version and SHA-256. | — |

`deps` (the libraries and the byte-fetching functions) is injected by the host, which
is what lets the same files run in both places.

### The layout model

It is plain JSON. It is the contract between extraction and the builders, and the
thing unit tests are written against.

- **Document:**
  - `pages[]`, each with size, margins (mm), `isCover`, `blocks[]`, an optional
    `layer` (full-page decoration PNG) and an optional `footer` (runs, logo PNG and
    size, distance from bottom).
  - **Blocks** are either `p` or `table`.
    - `p` carries: tag, runs, alignment, line height (pt), space-before and
      space-after (pt), indents, hanging indent, optional bullet glyph and style,
      optional tab stops, and `noWrap`.
    - `table` carries: kind (`table`, `columns` or `box`), rows, and cells with width,
      fill, padding, borders, vertical alignment and nested blocks.
  - **Runs** carry: text, family, weight, italic, size (pt), colour, letter-spacing,
    or `br`, `tab`, or `field: "PAGE"`.
- **Deck:** `slides[]`, each with a background and ordered `items[]`:
  - `shape` (rect, roundRect or ellipse, with fill, alpha, radius and shadow);
  - `image` (PNG, positioned);
  - `text` (a box plus paragraphs as above).

## Mapping rules

### Documents (.docx)

**Pages and sections**
- **Sections** are runs of pages sharing margins and footer, typically the cover plus
  the body.
- **Page breaks:** every page after the first in a section begins with
  `pageBreakBefore`. A page that begins with a table gets a spacer paragraph first.
- **Footer:** a borderless two-cell table, holding the text with a live `PAGE` field
  and the logo, both vertically centred.

**Paragraphs**
- **Line spacing:** proportional, always. The multiple is the CSS line height divided
  by the font's own line height, where the font's own line height is size ×
  (winAscent + winDescent) / unitsPerEm.
- **Spacing:** everything goes on space-before, measured from border boxes, plus
  padding.
- **Lines that never wrap** (`noWrap`, where the number of lines is at most the
  number of `<br>`s plus one) get 40 pt of slack on the side they grow towards, and
  hyphenation suppressed. Headings always have hyphenation suppressed.
- **Bullets** are real Word numbering, with the `::before` glyph, colour and face.
- **Contents rows:** two right tabs. The first ends where the HTML's leader box ends,
  with grey dots. The second right-aligns the page number at the column edge.
- **Headings** keep Heading 1–4 styles, so Word's navigation pane and Google's
  outline work.

**Tables and blocks**
- **Callouts and bordered sections** become one-cell tables.
- **Columns and numbered items** become borderless tables, with the gap as a spacer
  column.
- **Cells** get zero default margins, their padding as cell margins, and their own
  borders. A cell that is itself the paragraph does not count its padding twice.
- **Spacer paragraphs** are 1 pt lines with the paragraph mark sized too, carrying
  the gap as space-before.

**Decoration and settings**
- **The cover and any non-white page background** become one PNG anchored behind
  the text at 2× scale.
- **Settings:** `embedTrueTypeFonts`, automatic hyphenation, and document language
  from `<html lang>`.

### Decks (.pptx)

- **Layout:** the slide's own size in points, custom (1440 × 810 px gives
  15 × 8.4375 in). Font sizes carry over unchanged.
- **Native shapes** for solid fills with uniform radii (rect, roundRect, ellipse),
  with alpha and box-shadow mapped to an outer shadow. Everything else painted
  becomes a positioned PNG at 3×: gradients, non-uniform radii, inline SVG and
  images.
- **Text boxes:**
  - One per leaf text block, and one per list, so Enter adds a bullet.
  - Zero insets, top-anchored, no autofit.
  - Wrapped boxes get +0.5% width; `noWrap` boxes don't wrap.
  - Line spacing is exact points, which Google Slides handles.
  - The **vertical offset is calibrated** per (size, line-height ratio) against
    PowerPoint. The calibration table is produced during the build from a
    measurement slide and stored in `pptx.js`.
- **Bullets** get their colour and face patched in (`buClr`, `buFont`).

### Fonts

- **Source:** every face comes from the document's own `@font-face`, or from the
  editor's lent substitute for it. Nothing is hardcoded.
- **Office families:** name-table family 1 plus the bold and italic bits. Intermediate
  weights are families of their own ("… Medium", "… SemiBold").
- **Embedding:**
  - `.docx`: `word/fonts/fontN.odttf`, `fontTable.xml` entries with all present slots
    and fontKeys, relationships, content type, and `embedTrueTypeFonts`.
  - `.pptx`: `ppt/fonts/fontN.fntdata` (EOT), `embeddedFontLst` after `notesSz`, and
    `embedTrueTypeFonts="1"`.
  - The genre hint (swiss or roman) comes from OS/2 class, else PANOSE, else sans.
- **Permission:** a face whose `fsType` forbids embedding (bit 1 set, or
  preview-only) is not embedded, and the export reports it as a warning.

### Missing-glyph routing (the arrow fix)

This is the first build task, and it has a checkpoint.

For every run, the exporter finds characters outside the core Latin and Latin-1
punctuation set: arrows, ✓, and similar. These are exactly the characters an older
cloud copy of a face is likely to lack. They are routed to a **privately named
embedded copy** of the same face (name table rewritten, for example "DM Sans Glyphs"),
so Office must use the embedded file.

- **Word:** the private face goes in `w:hAnsi` (and `w:cs`) while `w:ascii` stays the
  real family. That is one run with no splitting, and Google, which reads the ascii
  font, should keep rendering its own DM Sans.
- **PowerPoint:** those characters become their own runs using the private face.

**Checkpoint.** Verify both in Word and PowerPoint for Mac. Then Luke checks the same
file in Google Docs and Slides.

If Google renders the routed characters wrongly, the choice is made then, explicitly:
correct arrows in Office, or correct arrows in Google. The fallback, if routing proves
unworkable, is to leave arrows on the real face and document the Office limitation.

## Editor integration

- **The button:** a toolbar button labelled **Export to Word** or **Export to
  PowerPoint** by kind. It is disabled, with a tooltip saying why, for unsupported
  documents.
- **The source is the bytes Save would write:** `build()` output, unsaved edits
  included. Those bytes render in a **fresh offscreen iframe**, 1600 × 1000, visible
  but positioned off-screen, never `display:none`, because a zero-size viewport breaks
  measurement. The live editing frame is never read.
- **Fonts are restored in that frame before extraction:** the frame goes through
  `restoreBrandFonts()` and `restoreLogos()`, so a non-self-contained document
  exports with the same faces the preview shows.
- **Vendor files are loaded lazily** on first export: classic scripts via `<script>`,
  the decoder via `import()`.
- **Saving:** `showSaveFilePicker` with `<name>.docx` or `<name>.pptx` suggested; in
  browsers without it, a download.
- **Before exporting,** pages with less than 3 mm headroom (from `headroomMM()`)
  trigger a warning that Word may push them onto an extra page. The user can go on.
- **After exporting,** any warnings are shown: an embedding refused, a face not
  found, or a page flagged.
- **`window.__hep.export()`** gets exposed for console testing.

**New invariant 8.** Export never writes the HTML file and never reads the live
editing frame. It reads only a fresh render of the bytes Save would produce, so no
instrumentation, highlight, `contenteditable` or pending-deletion hiding can reach an
exported file.

## Skill integration

Both skills get the same treatment.

- **The exporter files** are copied into the skill at `scripts/export/`, pinned to an
  editor commit recorded in `scripts/export/VERSION`.
- **`scripts/export-office.py <doc.html> [out]`:**
  - loads the HTML in Playwright's Chromium, the same way `generate-pdf.py` does;
  - injects vendor files and exporter as script content;
  - runs `HepExport.run` and writes `.docx` or `.pptx` by kind;
  - exits non-zero if the document is unsupported.
- **Verification**, mirroring the overflow gate:
  - convert the export through LibreOffice to PDF;
  - check the page or slide count equals the HTML's;
  - for documents, check the first and last words of every page match the HTML's
    pages;
  - write PNG previews for Claude's visual check.

  A mismatch exits 2 and names the page. `--force` exists but the skill says never
  to ship with it, as with `generate-pdf.py`.
- **`setup-sandbox.sh`** installs the skill's bundled TTFs into the user font
  directory and runs `fc-cache`, so LibreOffice renders the real faces.
- **SKILL.md** gets a new step: export on request, run verification, deliver alongside
  the HTML and PDF, and tell the user that recipients editing in Office should ideally
  have the fonts installed. It also adds the pending line about the letter-spacing
  warning.
- **Release:** v1.5 of both skills, through the existing checklists (the five-file
  version bump, the rebuild, the org upload, and checking the org skill cache).

## Testing

**Unit tests (`npm test`, Node)**
- **Fonts:**
  - an odttf round trip (de-obfuscating reproduces the TTF);
  - EOT header fields against the source font;
  - face mapping for intermediate weights;
  - `fsType` refusal;
  - the missing-glyph splitter.
- **Builders:** feed small hand-written models and assert the generated XML.
  - page breaks;
  - proportional spacing, with no `lineRule="exact"` anywhere in a .docx;
  - tab stops;
  - font-table slots;
  - `embeddedFontLst` position;
  - no `data-hep`, `contenteditable` or `hep-` strings in any output.
- **The vendored libraries** load in Node through `vm`, from the same files the
  browser uses.

**Fidelity checks** (manual and scripted, per the spike's method)
- export real documents from both design systems, render in Word and PowerPoint for
  Mac, and compare page by page with the PDF;
- include one document with a review block;
- include one that isn't self-contained, to exercise lent fonts.

**Google pass:** Luke checks one document and one deck in Google Docs and Slides
before the skill release. The deck check must confirm that exact line spacing survives
Google Slides, because round 1 of the spike did not record which deck variant was
checked. If it does not survive, decks switch to proportional spacing, as documents
already have.

**Known gap:** this Mac has the second design system's fonts installed, so embedding
for that system cannot be proved locally.

## Documentation

- **`CLAUDE.md`:** invariant 8, an export section covering the model, mapping rules,
  the Google and Office traps above, and fonts.
- **`SNAGS.md`:** the spike's findings as the record of *why*.
- **`CHANGELOG.md`:** an entry per push.
- **`README.md`:** the user-facing export description.
- **Team Guide:** recommend installing the brand fonts for anyone who edits exports in
  Office for the web, where embedded fonts are ignored.

## Risks

- **Vertical calibration in PowerPoint** is empirical. If it doesn't generalise across
  sizes, the fallback is a per-size table and larger error bars.
- **LibreOffice paginates slightly differently from Word.** The skill's page check
  could be noisier than the PDF overflow gate. Word text is 1.5% more compact than the
  HTML, because the cloud font is narrower, which errs safe. The check compares page
  count and page boundaries, not pixels.
- **Vendored library updates** are manual and pinned. A `docx` or `pptxgenjs` upgrade
  must re-run the fidelity checks, because the post-processing depends on their exact
  XML.
- **Microsoft could update cloud DM Sans.** Missing-glyph routing is written to be
  harmless if the cloud copy gains arrows.
