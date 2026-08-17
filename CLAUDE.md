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
   attributes to a *copy* used only for rendering. Saving always builds from the
   pristine `scan.source`. Assert `data-hep` and `contenteditable` are absent
   from any saved output.

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
bounding rects) and is reported in millimetres.

Hidden slides report zero size, so a full sweep needs `scroll-mode` on the body.
That relayout moves the caret, so live checks cover only the visible slide and
`overflowing()` does the full sweep before saving.

## Testing

```bash
npm test
```

18 tests. Two of them round-trip a real production document and skip unless you
point them at one — client documents are never committed:

```bash
HEP_FIXTURE="/path/to/a/document.html" npm test
```

The strongest check, worth re-running after engine changes: scan the original and
the saved file, assert the concatenated **markup** (everything outside text runs)
is byte-identical, assert only the intended runs differ, and assert reversing
those edits reproduces the original exactly.

For UI work, serve the folder (`.claude/launch.json` defines the `editor` config
on port 8765) — ES modules won't load from `file://`. `window.__hep` exposes
`load()`, `state()`, `type()` and `build()` so the source↔preview correlation can
be driven from the console. `state().unverifiedElements` should be 0 for
documents and 1 for decks (the slide counter).

## Branding

The chrome follows the Switch design system in `../Switch PDF Generator/switch-design-system.md`.
Canonical palette, DM Sans + Source Serif 4 as local WOFF2 in `assets/fonts/`
(converted from the kit's TTFs with `fontTools`, same as `make-selfcontained.py`),
the real logotype as inline SVG recoloured via `currentColor`, plus the 2×2
geometric motif, 3px bean-green left-border callouts and `→` arrow bullets.

`--alert: #c0392b` is lifted from the templates' own overflow badge so warnings
match. It and `--caution` are the only non-palette values.

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
