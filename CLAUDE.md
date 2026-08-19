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

2. **Untouched runs are never rewritten.** `applyEdits` drops any edit whose
   encoded text equals the existing raw bytes, so a no-op save is byte-identical.
   Don't "normalise" text on the way through.

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

## Review comments

Comments let the user flag text for Claude instead of fixing it themselves, which
covers everything editing can't: restructuring, tone, claims to check.

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
- Only the fields in `PERSISTED` reach the file; `range` and `resolved` are
  working state. `dirty()` covers edits *and* comment changes, so reopening a
  file that already has comments is correctly not dirty.

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

27 tests. Three of them round-trip a real production document and skip unless
you point them at one — client documents are never committed:

```bash
HEP_FIXTURE="/path/to/a/document.html" npm test
```

The strongest check, worth re-running after engine changes: scan the original and
the saved file, assert the concatenated **markup** (everything outside text runs)
is byte-identical, assert only the intended runs differ, and assert reversing
those edits reproduces the original exactly.

For UI work, serve the folder (`.claude/launch.json` defines the `editor` config
on port 8765) — ES modules won't load from `file://`. `window.__hep` exposes
`load()`, `state()`, `type()`, `comment()`, `comments()`, `setZoom()` and
`build()` so the source↔preview correlation can be driven from the console.

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

## House rules

- **This repo is public.** No client or brand names in files, commit messages, or
  test fixture paths. `.gitignore` blocks `*.html` except `index.html`, plus PDFs
  and Office files.
- The tool is referenced from `switch-documents` SKILL.md step 5, the packaged
  `.skill` bundle, the Team Guide and the announcement email. **Changing the
  deployed URL means updating all four** — the URL derives from the GitHub
  username and repo name, so don't rename the repo.
