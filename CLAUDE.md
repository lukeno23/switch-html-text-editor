# Switch HTML Text Editor — working notes

Context for picking this up later. `README.md` is user-facing; this file is for
whoever develops it next. `SNAGS.md` is the backlog.

Live: https://lukeno23.github.io/switch-html-text-editor/
Repo: https://github.com/lukeno23/switch-html-text-editor (public)

## What it is

A single static page that opens a self-contained Switch HTML document, renders it
in an iframe exactly as it will print, lets the user edit the text in that live
preview, and saves back to the same file on disk — changing only the bytes of the
text they touched.

Two files do the work: `src/patch-engine.js` (pure, tested, no DOM) and
`index.html` (UI + browser wiring). No build step, no dependencies, no backend.

## The invariants

Break any of these and the tool silently corrupts client documents. They are the
whole point of the design.

1. **Never serialize a DOM back to the file.** The engine records `[start,end)`
   byte offsets of every text run in the raw source and splices edits into the
   original string. A DOM round-trip would reflow indentation, reorder
   attributes, drop comments and endanger the 7 embedded base64 WOFF2 blobs and
   the `FONTS-START`/`FONTS-END` markers that `make-selfcontained.py` needs.

2. **Untouched runs are never rewritten.** `applyEdits` drops an edit when the
   DECODED text is unchanged *or* when the encoded bytes match the raw bytes, and
   both checks are load-bearing. `decodeEntities` knows far more entities than
   `encodeText` re-emits — `&middot;` decodes to `·` and encodes back to a literal
   `·` — so an encoded-only comparison concludes the run changed and rewrites
   bytes nobody touched. That shipped briefly and a real document caught it: 30
   footer runs would have been rewritten by a no-op save. Don't "normalise" text
   on the way through, and don't remove either check.

3. **Only render-verified nodes become editable.** `wireElement()` compares the
   rendered text node against the scanned source run and refuses the element if
   they differ. Anything the scanner mis-modelled ends up read-only, never
   mis-written. If you loosen this check you remove the safety net.

4. **Script-generated text must stay read-only.** The deck's `1 / 13` counter and
   page numbers are written at runtime and have no fixed counterpart in the
   source. Invariant 3 catches them automatically — that's why the load message
   reporting "N left read-only" is normal, not a bug.

5. **Instrumentation must never reach disk.** `instrument()` adds `data-hep`
   attributes to a *copy* used only for rendering, and `installHighlightStyle()`
   injects a `<style>` into that copy's `<head>`. Saving always builds from the
   pristine `scan.source`. Assert `data-hep`, `contenteditable`, `spellcheck`
   and `hep-highlight-style` are absent from any saved output.

6. **Exactly one region outside the text runs may be written: the review block.**
   This is the single, deliberate exception to invariant 2. It is bounded — one
   marker-delimited HTML comment (`SWITCH-REVIEW-START` / `SWITCH-REVIEW-END`)
   immediately before `</body>`, written only by `writeReview()`, never inside a
   text run. It is safe because HTML comments do not render (so the PDF is
   unaffected) and `scanDocument()` skips comments (so it can never become
   editable text). Removing every comment must restore the file byte-for-byte —
   there is a test for exactly that, on a real document. Do not widen this
   exception; if something else needs persisting, it goes in this block.

7. **Deleting a block is the second bounded exception.** `applyEdits` accepts
   element ids to remove outright, markup and all. It is bounded three ways: the
   element must have an explicitly recorded closing tag (see below), the range is
   exactly `[openTagStart, closeTagEnd)` plus the newline and indent before it,
   and nothing else in the file is touched. There is a test asserting the output
   equals the source with precisely that span cut out.

## How source and preview are correlated

The hard problem is knowing which rendered text node maps to which source bytes,
given the browser's HTML parser does error recovery the scanner doesn't model.

1. `scanDocument()` walks the raw source, building elements with their direct
   child text runs and offsets. It is a scanner, not a spec parser — it skips
   `script`/`style` interiors, comments, doctype, `head` and `svg`.
2. `instrument()` adds `data-hep="<elementId>"` to the open tag of each element
   holding editable text. **Attributes only** — no structural change, so layout
   and selectors are unaffected. Verified: the Switch templates use no attribute
   selectors, and `:first-child`/`:last-child` are unaffected by attributes.
3. The iframe renders the instrumented copy. For each `[data-hep]` element, its
   non-whitespace direct child text nodes are matched to that element's editable
   runs **by ordinal, then confirmed by text equality**. Scoping ordinals inside
   a single element keeps table foster-parenting and whitespace quirks harmless.

Why not wrap each text node in a span: it would make the span the first element
child, breaking `:first-child` rules. Attributes are the only safe instrument.

**Entity coverage decides editability, not just display.** Step 3 compares the
scanned source text against the rendered DOM text, so an entity the scanner can't
decode (`&eacute;` in the source, `é` on screen) fails the comparison and makes
its whole element read-only. `ENTITY_CODE_POINTS` therefore carries the full HTML4
Latin-1 set plus common punctuation — 166 names. Expanding it is safe and makes
more text editable; `encodeText` stays deliberately minimal, re-emitting only the
parsing-critical characters and the invisible ones (NBSP, soft hyphen, en/em/thin
space) that would otherwise be impossible to spot in a diff. Editing a run does
rewrite its entity spelling; leaving it alone does not, which is invariant 2.

## Review comments

Comments let the user flag text for Claude instead of fixing it themselves, which
covers everything editing can't: restructuring, tone, claims to check.

- **`findRange()` walks every text node under `<body>`.** It must not filter by
  structure: requiring a `.page`/`.slide` ancestor meant comments on flowing
  documents were written to the file and came back permanently stale. Scoring on
  quote, context and element id is what makes anchoring accurate.
- **Anchored by content, not offsets.** Each comment stores its quoted text, ~24
  characters of context either side, and the `data-hep` element id as a
  tiebreaker. `findRange()` scores candidates on those three and takes the best.
  Byte offsets would break the moment anything above them changed; content
  anchors survive edits elsewhere and survive Claude rewriting the document.
- **Stale anchors are flagged, never dropped.** If the quote no longer matches,
  the comment stays in the file, is marked in the panel, and isn't highlighted.
- **Highlighting uses the CSS Custom Highlight API.** It paints arbitrary ranges
  with zero DOM change, which is the only technique compatible with invariant 3's
  attributes-only rule — wrapping the range in a `<span>` would make it the first
  element child and break `:first-child`.
- **Comments can attach to read-only text**, including the script-generated slide
  counter, since commenting needs no mapped run.
- **An unquotable selection gets an explanation, not silence.** `unquotableReason()`
  distinguishes crossing an inline boundary from spanning blocks, and `#selectHint`
  appears where the Comment button would be. The templates lead paragraphs with
  `<strong>`, so users hit this constantly — don't quietly drop the hint. Every
  path that rejects a selection must also clear `pendingSelection`, or a stale one
  could be committed against the wrong text.
- Only the fields in `PERSISTED` reach the file; `range` and `resolved` are
  working state. `dirty()` covers edits *and* comment changes, so reopening a
  file that already has comments is correctly not dirty.

## Deleting blocks

The scanner records `closeTagStart`/`closeTagEnd` when the tag stack unwinds, and
**only for the element the closing tag actually closes**. Anything popped above it
was closed implicitly — which this scanner does not model — so it gets `null` and
`elementRange()` refuses it. That is why an unclosed `<li>` cannot be deleted: the
end is a guess, and guessing here corrupts files.

Containers carry no `data-hep`, because only elements with editable text are
instrumented. `sourceIdFor()` therefore climbs the DOM and the scanned tree in
lockstep from a known-mapped descendant, **checking tag names agree at every
step**. Divergence means the parser did something the scanner didn't model, so the
element is simply not offered. Same principle as invariant 3: derive, then verify.

Other rules worth keeping:

- `<td>`/`<th>` are deliberately not deletable — removing one cell breaks its
  row's column count. `<tr>` is the unit instead.
- `.page`, `.slide`, `.page-body`, `.wrap`, `main` and `body` are protected, as is
  anything containing a `.page`/`.slide`. Deleting a page changes pagination,
  which is a rebuild, not a text edit.
- Deletions are **pending until save**: the element is hidden in the render copy
  (`display:none` on a copy that never reaches disk) rather than removed. Undo is
  therefore free — the nodes and their run mapping are still intact — and the
  integrity net never sees a mutated DOM.
- A deletion supersedes pending edits and comments inside it. Both are dropped at
  queue time so the counts stay honest, and `applyEdits` skips any that remain
  rather than throwing on the overlap.
- Nested deletions collapse to the outer range; partially overlapping ones throw.
- **On fixed-page templates nothing reflows into the gap.** Each `.page` is a
  rigid card, so a deletion leaves white space and nothing moves up from the next
  page. The panel says so, because otherwise it reads as a bug. Flowing documents
  reflow normally, which is where the feature earns most of its value.

## Editing safety

`contenteditable="plaintext-only"` sits on the *parent element* (no DOM change),
with two layers under it:

- `guardInput` (beforeinput, capture) allows only a whitelist of input types and
  rejects any target range that crosses a text-node boundary or lands on an
  unmapped node.
- `onInput` re-checks that the element's text nodes are still the mapped ones. If
  not, `restore()` puts back the snapshot **and re-wires the element plus every
  `[data-hep]` descendant** — re-wiring only direct children silently leaves
  nested `<strong>` read-only. That bug happened once; don't reintroduce it.

Document keybindings are contained by stopping `keydown`/`keypress`/`keyup`
propagation while the caret is in editable text, without `preventDefault` so the
character still inserts. The presentation template binds Space, ArrowRight and
PageDown on `window`; without this, typing a space advances the slide.

## Lending the document our fonts

`restoreBrandFonts()` substitutes the editor's bundled brand faces for any
`@font-face` that failed, which is what makes a non-self-contained document look
right. Two invariants inside it:

- **Only failed faces are replaced.** A self-contained document has working
  embedded fonts and overriding them would change what the preview shows. Faces
  load lazily, so each one is explicitly `load()`ed to find out whether it works —
  reading `.status` alone reports `unloaded` for anything not yet used.
- **The substitute `<style>` is render-copy only**, like the highlight style. Assert
  `hep-font-substitutes` is absent from saved output (invariant 5).

It runs at the top of `wire()`, before anything measures layout, because overflow
and headroom are measured against the rendered type. `wire()` is therefore async
and the frame `load` handler catches its rejection.

Anything unfixable — a broken image, a non-brand typeface — goes in the `#fidelity`
pill rather than being silently ignored. All seven Switch faces are bundled in
`assets/fonts/` (~207KB); four are used by the editor's own chrome, the other three
exist purely to lend to documents.

## Telling a page card from a `div.page`

`.page` and `.slide` are ordinary class names. `looksLikeCards()` requires a
`.page-body`/`.slide-body`, or several cards that clip overflow, before treating a
document as paged — one real document uses `.page` for a content-height wrapper
and got a meaningless "0mm spare" plus a pointless zoom control. Everything that
labels a location (`onSelectionChange`, `queueDeletion`, the fit pill) goes through
`cards()` so the whole UI agrees about whether the document has pages at all.

## Overflow checking

Both templates use fixed-size cards that never reflow, so longer text is clipped
in the PDF rather than flowing on. The editor mirrors each template's own
measurement so it agrees with `generate-pdf.py`:

- Pages: `scrollHeight - clientHeight` on `.page-body`.
- Slides: both axes on `.slide`, with `.bleed` elements excluded.

Note `scrollHeight` can never report *spare* room — with `overflow:hidden` it is
clamped to the box. Headroom therefore comes from real geometry (children's
bounding rects) and is reported in millimetres. Headroom is only measured where
there is a `.slide-body`; cover, statement and divider slides fill their canvas
by design, so measuring them returns a misleading 0mm and masks the genuinely
tight slide. Overflow is still checked on all of them.

Hidden slides report zero size, so the sweep needs `scroll-mode` on the body.
`withAllVisible()` saves and restores the selection range and scroll position
around that relayout, and everything inside is synchronous so no intermediate
paint occurs — which is what makes a full sweep safe on every keystroke. Don't
reintroduce a visible-slide-only fast path; it silently missed overflows.

Zoom uses the CSS `zoom` property, never a `transform`: `transform` scales
painting but not hit-testing, so the caret would land away from where it is
drawn. Because `scrollHeight`, `clientHeight` and the millimetre probe all scale
together, overflow readings are identical at any zoom. `measureMM()` is re-run at
the top of `refreshLayout()` for that reason. Zoom is hidden for decks, whose
template already scales itself.

## Testing

```bash
npm test
```

37 tests. Four of them round-trip a real production document and skip unless you
point them at one — client documents are never committed:

```bash
HEP_FIXTURE="/path/to/a/document.html" npm test
```

The strongest check, worth re-running after engine changes: scan the original and
the saved file, assert the concatenated **markup** (everything outside text runs)
is byte-identical, assert only the intended runs differ, and assert reversing
those edits reproduces the original exactly.

Run it against **several documents from different design systems**, not just one.
Every serious bug so far was found by the first document outside the pair the
engine was built against: the `&middot;` no-op rewrite, accented characters
locking elements, and commenting being impossible without page cards. Assertions
must not assume Switch structure either — assert on what the document actually
carries (`if (src.includes(marker))`), or the suite fails on its own assumptions.

For UI work, serve the folder (`.claude/launch.json` defines the `editor` config
on port 8765) — ES modules won't load from `file://`. `window.__hep` exposes
`load()`, `state()`, `type()`, `comment()`, `comments()`, `deleteAt()`,
`deletions()`, `restoreAll()`, `setZoom()` and `build()` so the source↔preview
correlation can be driven from the console.

Two traps when testing from the console: `load()` starts with a `confirm()` when
there are unsaved changes, and an automated context auto-dismisses it so `load()`
returns early and you silently keep the previous document's state. Reload the
page between loads. And `__hep.comment()` skips hidden elements, because a hidden
slide can't be selected by a real user either. `state().unverifiedElements` should be 0 for
documents and 1 for decks (the slide counter).

## Branding

The chrome follows the Switch design system in `../Switch PDF Generator/switch-design-system.md`.
Canonical palette, DM Sans + Source Serif 4 as local WOFF2 in `assets/fonts/`
(converted from the kit's TTFs with `fontTools`, same as `make-selfcontained.py`),
the real logotype as inline SVG recoloured via `currentColor`, plus the 2×2
geometric motif, 3px bean-green left-border callouts and `→` arrow bullets.

`--alert: #c0392b` is lifted from the templates' own overflow badge so warnings
match. It and `--caution` are the only non-palette values. `possible-purple`
carries counts and review annotation, keeping it clear of the main accents.

## Deploying

Push to `main`; GitHub Pages serves the root. `.nojekyll` stops Jekyll touching
the JS. Pages takes a minute or two — poll until the build's `commit` matches
`HEAD`, since `builds/latest` returns the previous build until the new one starts.

## Picking this up again

Read `SNAGS.md` first: it holds the agreed upgrade shortlist under "Proposed
upgrades", the open limitations, and — most usefully — *why* each fixed bug happened.

Two things that are true as of 19 Aug 2026 and easy to trip over:

- **`switch-documents` SKILL.md is behind the editor.** It was rebuilt at kit v1.2
  describing typing and commenting; the editor has since gained block and section
  deletion, an editable `<title>`, zoom and brand-font substitution. Step 5 needs a
  refresh, and whether v1.2 was ever uploaded to org settings was never confirmed.
  Each release costs a five-file version bump plus an org upload, so bundle it with
  the next real change rather than shipping on its own.
- **Test breadth is what finds bugs here.** Every serious defect so far came from the
  first document in an unfamiliar style, never from more tests on familiar ones. Ask
  for a new file before calling a feature done.

## House rules

- **This repo is public.** No client or brand names in files, commit messages,
  test fixture paths, or test data strings — that last one has caught me twice.
  `grep -rniE "<clientnames>" $(git ls-files)` before every commit. `.gitignore` blocks `*.html` except `index.html`, plus PDFs
  and Office files.
- The tool is referenced from `switch-documents` SKILL.md step 5, the packaged
  `.skill` bundle, the Team Guide and the announcement email. **Changing the
  deployed URL means updating all four** — the URL derives from the GitHub
  username and repo name, so don't rename the repo.
