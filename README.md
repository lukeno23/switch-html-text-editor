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

## Flagging text for Claude

Editing only solves wording. For anything needing judgement — a claim to check, a
paragraph to restructure, a tone problem — select the text and click **Comment**.

Comments are stored in the file itself, in one marker-delimited HTML comment
before `</body>`:

```html
<!-- SWITCH-REVIEW-START
[{"id":1,"kind":"page","page":3,"quote":"…","note":"expand this"}]
SWITCH-REVIEW-END -->
```

HTML comments don't render, so the PDF is unaffected and the file stays valid for
`make-selfcontained.py` and `generate-pdf.py`. Removing every comment restores the
file byte-for-byte.

So one file carries both your wording fixes and your notes. Hand it back to Claude
and ask it to address the comments; **Copy brief for Claude** puts a plain-text
summary on the clipboard if you'd rather paste the context too.

Commented ranges are highlighted in the preview using the CSS Custom Highlight
API, which paints arbitrary ranges without touching the DOM — the only technique
that doesn't break the attributes-only instrumentation rule.

You can comment on text the editor can't *edit*, including script-generated page
numbers and slide counters. Comments are anchored by their quoted text plus
surrounding context and the element they sit in, so they survive edits elsewhere.
If the quoted text itself changes, the comment is kept and flagged rather than
silently dropped.

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

## Zoom and the document title

A4 pages are wider than most laptop windows, so the toolbar has a zoom control
with a **Fit** button. It uses the CSS `zoom` property, not a `transform`, so the
caret stays where it is drawn and overflow measurement is unaffected. Zoom is
hidden for presentations, which already scale themselves to the viewport.

`<title>` lives in `<head>` and so has nothing to click in the preview. The
**Title** button opens a field for it.

## Branding

The interface follows the Switch design system (Kit v1.1):

- **Canonical "Shades of Sage" palette** — `green-unknown` chrome, `bean-green`
  for the primary action and accents, `misty-mint` on dark, `possible-purple`
  reserved for counts and review annotation, keeping it off the main accents.
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
  document's structure is blocked. Use a comment for anything structural.
- **Comments need a selection inside one text node**, so you can't comment across
  an inline boundary like a `<strong>` lead-in and the sentence after it. The
  editor says so when you try, and tells you what to select instead.
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

27 tests covering the entity codec, the scanner (script/style interiors,
quoted-attribute edge cases, comments, SVG, whitespace), instrumentation, edit
application, overlap rejection, the review block (round-trip, replacement rather
than stacking, `-->` escaping, unparseable blocks, composition with edits), and
three round-trip tests against a real production document.

Those three skip unless you point them at one — client documents are never
committed:

```bash
HEP_FIXTURE="/path/to/a/document.html" npm test
```

To exercise the UI, serve the folder and open it:

```bash
python3 -m http.server 8765
```

`window.__hep` exposes `load()`, `state()`, `type()`, `comment()`, `comments()`,
`setZoom()` and `build()` for driving the source↔preview correlation from the
console.
