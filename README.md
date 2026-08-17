# HTML Text Editor

Edit the words in a finished HTML document, in its own live preview, and save
back to the same file — without changing a single byte of formatting.

Built for the Switch document templates — A4 white papers and 16:9
presentations — but it works on any self-contained HTML file.

## The guarantee

Most WYSIWYG HTML editors render your file into a DOM, let you edit, then write
the DOM back out. That round-trip rewrites the whole file: attribute order
changes, quotes normalise, indentation reflows, comments disappear.

This one never serializes a DOM. It records the exact byte offsets of every text
run in the source and splices your edits into the original string. Anything you
didn't type is not rewritten — it is not even touched.

Verified against a real 339KB A4 white paper (7 embedded WOFF2 fonts, inline SVG
logo, 22 fixed pages):

| Check | Result |
|---|---|
| Full no-op round-trip vs original | md5-identical |
| Text runs found | 880 (371 editable, 508 whitespace, 1 `<title>`) |
| After editing 2 paragraphs — runs changed | exactly 2 |
| After editing 2 paragraphs — markup bytes changed | 0 of 311,930 |
| Reversing those edits | reproduces the original file exactly |
| Embedded font blobs / `FONTS-START` markers | intact |
| Editor's own instrumentation in saved file | none |

The same holds for presentations. Editing the cover heading of a 13-slide client
deck changed 1 run and left all 307,763 markup bytes identical.

## Overflow warnings

Both Switch templates use fixed-size cards and **never auto-flow content** — so
making a paragraph longer doesn't push text to the next page, it clips it,
silently, in the generated PDF.

The editor re-runs the same measurement each template's own script uses, after
every keystroke, and reuses the template's `.has-overflow` class so the red
warning banner the design system already draws appears live. It reports how much
spare room the tightest page or slide has, in millimetres, and does a full sweep
of every card — including hidden slides — before saving, asking for confirmation
if anything overflows.

After saving, regenerate the PDF as usual with `generate-pdf.py`.

## Branding

The interface follows the Switch design system (Kit v1.1):

- **Canonical "Shades of Sage" palette** — `green-unknown` chrome, `bean-green`
  for the primary action and accents, `misty-mint` on dark, `possible-purple`
  reserved for the edit count, following the rule that purple is for numbered
  things only.
- **Brand fonts, local WOFF2** — DM Sans 400/500/700 throughout, Source Serif 4
  sparingly for the cover-meta line. Converted from the kit's own TTFs with
  `fontTools`, same as `make-selfcontained.py` does. No Google Fonts.
- **The real logotype**, inlined as SVG (viewBox 1080×340, all seven elements)
  and recoloured with `currentColor` — `misty-mint` on the dark toolbar. Never a
  text approximation.
- **Brand devices reused rather than reinvented** — the 2×2 geometric motif on
  the empty state, 3px `bean-green` left-border callouts, `→` arrow bullets in
  `bean-green`, and light/dark alternation between the empty state and the chrome.
- **Alert colours** are the only non-palette values. `#c0392b` is taken directly
  from the templates' own overflow badge, so a warning here matches the warning
  drawn on the page itself; `#c9821f` is its lower-severity partner.

## Browser support

**Chrome or Edge** for saving in place — they support the File System Access
API, which is what lets a web page write back to a file you chose.

Safari and Firefox cannot write to local files. The editor still opens and edits
documents there, but Save downloads an edited copy instead.

## Deploying to GitHub Pages

The editor is entirely client-side. Documents are opened by the browser and
never uploaded anywhere, so a public repo is fine — it contains the editor, not
your content.

1. Create a new repository on github.com.
2. Upload `index.html` and the `src/` folder (drag them into the repo page, or
   `git push`).
3. Repo → **Settings** → **Pages** → set Source to `main` / `/ (root)` → Save.
4. Wait a minute, then open `https://<your-username>.github.io/<repo>/`.

HTTPS comes free, which the File System Access API requires. For a Dock icon,
open the page in Chrome and use **Install page as app**.

`.gitignore` blocks `*.html` except `index.html`, plus PDFs and Office files, so
client documents cannot be committed by accident.

## Known limitations

- **Text only.** Styling, layout and structure cannot be changed — by design.
  Pressing Return, pasting formatted content, and anything that would alter the
  document's structure is blocked.
- **Logo and SVG text are locked**, so the Switch logotype can't be broken.
- **Script-generated text is read-only.** Slide counters and page numbers are
  written at runtime, so they have no fixed counterpart in the source. The editor
  detects this and says so on load.
- **Documents must be self-contained.** Run `make-selfcontained.py` first, as the
  skill already instructs.

The full running list, including what's fixed and what's deliberately out of
scope, is in [SNAGS.md](SNAGS.md).

## Development

```bash
npm test
```

18 tests covering the entity codec, the scanner (script/style interiors,
quoted-attribute edge cases, comments, SVG, whitespace), instrumentation,
edit application, overlap rejection, and two round-trip tests against the real
white paper.

To exercise the UI, serve the folder and open it:

```bash
python3 -m http.server 8765
```

`window.__hep` exposes `load()`, `state()`, `type()` and `build()` for testing
the source↔preview correlation from the console.
