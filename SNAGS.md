# Snag list

Running list of known issues and things deliberately left out. Newest first.

## Fixed

### The selection actions could be clipped off the window edge
*Fixed 19 Aug 2026.* The floating actions are centred on the selection via
`translate(-50%)`, which was fine with one button. Adding the two delete actions
made the bar ~470px wide, so selecting near the left edge pushed **Comment** off
screen entirely. `positionOver()` now clamps the bar within the window.

### The empty state could hide its own button below the fold
*Fixed 19 Aug 2026.* `#drop` centred with `place-items: center` and
`overflow: hidden`. Once the copy grew to four bullets plus the Claude handover,
a 820×600 window put the content at 736px in a 548px box — with **Choose a file…**
and the browser notice unreachable and unscrollable.

Now centred with flex plus `margin: auto`, which centres when there is room and
scrolls when there isn't, and a `max-height: 780px` rule tightens the type. Both
verified reachable at 820×600.

### Commenting was impossible on any document without page cards
*Found and fixed 19 Aug 2026, by testing six documents from three different
design systems.*

`onSelectionChange` looked up `.closest('.page, .slide')` to work out a page
number, and bailed out when it found nothing. Documents that simply flow — most
hand-built HTML — have neither, so the Comment button never appeared and there
was no explanation. Editing worked perfectly on those documents throughout, which
is why it went unnoticed.

Page cards are now optional. Where they exist a comment still records `Page 3` or
`Slide 7`; where they don't, it records the nearest heading above the selection
(`kind: "section"`, `where: "..."`), which gives Claude something to navigate by.
The panel, the toast and the copied brief all use whichever is available.

### A no-op save rewrote runs containing entities we don't re-emit
*Found and fixed 19 Aug 2026, by testing a document outside the original two.*

`decodeEntities` knows many more named entities than `encodeText` re-emits.
`&middot;` decoded to `·` and encoded back to a literal `·`, so the drop check —
which compared only the encoded bytes against the raw bytes — concluded the run
had changed. **30 footer runs would have been rewritten by a save that touched
nothing.** The first two test documents only used `&amp;`, so it never showed.

`applyEdits` now also drops an edit when the decoded text is unchanged, which
makes a no-op byte-identical whatever entity spelling the source used. Editing a
run still rewrites its spelling within that run, which is allowed and documented.

`encodeText` additionally re-emits invisible characters — soft hyphen, en, em and
thin spaces — as named entities, since a literal one is impossible to spot in a
diff. Visible characters stay literal; re-encoding them would rewrite user text.

### Accented characters made their whole element read-only
*Fixed 19 Aug 2026.* Entity coverage decides editability, not just display: a run
is only editable when the scanned source text matches the rendered DOM text, so
`&eacute;` in the source against `é` on screen failed verification. On a real
16-page document that left 4 elements read-only, including a table cell and a
paragraph.

The entity table now carries the full HTML4 Latin-1 set plus common punctuation
(166 names), taking that document from 315/319 mapped to **319/319**. Expanding
decoding is safe precisely because of the no-op fix above.

### Fit zoom ignored landscape pages
*Fixed 19 Aug 2026.* **Fit** measured the first `.page`. A document mixing
portrait with landscape pages (297mm wide) still overflowed sideways on the
landscape ones. It now fits the widest page.

### The Comment button silently didn't appear on some selections
*Fixed 19 Aug 2026.* A comment is anchored by its quoted text, so the selection
has to sit inside one text node. The Switch templates lead paragraphs with
`<strong>Bold.</strong> body text`, so selections crossing that boundary are
common — and the button simply withheld itself with no explanation.

An explanatory chip now appears in the button's own position, with an amber left
border so it reads as information rather than an action, and it names the fix:

- crossing bold or italic → *"Select within one run of text — this selection
  crosses bold or italic. Comment on the plain part or the bold part separately."*
- spanning paragraphs → *"Select within one paragraph — this selection spans
  several, so there is no single piece of text to attach a comment to."*

The two cases are told apart by comparing the nearest block ancestor of each end
of the range. Verified all four states on a real document (valid selection,
inline crossing, cross-paragraph, cleared selection), and verified by real mouse
drag that following the advice does then produce the Comment button.

This also closed a latent bug: `pendingSelection` was left stale when a selection
became invalid, so it is now cleared on every invalid path. Confirmed that
clicking *Add comment* after an unquotable selection adds nothing.

### No zoom control
*Fixed 17 Aug 2026.* A4 pages are 210mm wide, which overflows most laptop
windows. There is now a zoom control in the toolbar with a **Fit** button that
sizes the page to the window.

It uses the CSS `zoom` property rather than a `transform`. That was the whole
risk in this snag: `transform` scales painting but not hit-testing, so the caret
lands away from where it is drawn. `zoom` scales layout and hit-testing together.
Verified at 70% zoom that `caretPositionFromPoint` on a character's own rect
resolves to the correct text node and offset, and verified that overflow
measurement reads identically at 90% and 100% (`14mm spare` at both), because
`scrollHeight`, `clientHeight` and the millimetre probe all scale together.

The control is hidden for presentations — the deck template already scales itself
to the viewport, so zooming it would fight its own `fit()` logic.

### `<title>` was not editable
*Fixed 17 Aug 2026.* The document title lives in `<head>`, so there is nothing to
click in the preview. A **Title** button in the toolbar now opens a slim bar with
a text field. No engine change was needed: `<title>` is an ordinary text run with
ordinary offsets, it was only excluded from the *editable* set because it isn't
visible in the preview. Editing it patches exactly those bytes and nothing else.

### Live overflow on decks covered only the visible slide
*Fixed 17 Aug 2026.* Hidden slides report zero size, so measuring them all needs
every slide visible — which was previously judged too disruptive to do on each
keystroke because the relayout moves the caret.

It is now done on every pass. `withAllVisible()` saves the selection range and
scroll position, does the measurement, and restores both. Everything in it is
synchronous, so the browser never paints the intermediate state. Verified with
the caret placed mid-word: after an edit triggering a full sweep, the caret is
still in the same text node at the same offset, the scroll position is unchanged,
the visible slide is unchanged, and `scroll-mode` is not left switched on.

### Spacebar advanced the slide instead of typing a space
*Reported 17 Aug 2026 — fixed same day.*

The presentation template binds `Space`, `ArrowRight` and `PageDown` on `window`
to advance the deck, with no check for whether the caret is in text. The editor
now stops keyboard events reaching the document's own handlers while the caret is
inside editable text. It never calls `preventDefault`, so the browser still
inserts the character. Slide navigation still works when the caret is elsewhere.

## Open

### Comments on a deck need you to navigate to the slide first
Hidden slides cannot be selected, so you can only comment on the slide you are
looking at. That matches how you would work anyway, but there is no way to
comment on a slide from a list view.

### Stale anchors are flagged, not repaired
If the quoted text changes — you edit it, or Claude rewrites it — the comment is
kept, marked in the panel, and left unhighlighted. It is never silently dropped.
Re-anchoring it to the replacement text would need a similarity match that could
guess wrong, so it is deliberately left to the user to remove or redo.

## Won't fix (by design)

### Deleting a block on a fixed-page template leaves the space empty
Each `.page` is a rigid 210×297mm card and content never reflows between pages —
that is the template's central design decision, and the rule `generate-pdf.py`
enforces. So deleting a paragraph on page 4 leaves a gap on page 4; nothing moves
up from page 5, ever. The deletions panel says this outright and points at the only
thing that can close the gap, which is asking Claude to re-flow the pages.

Flowing documents, which have no page cards, reflow normally — so this is a
property of the template, not a limitation of the editor.

### Headroom is not measured on cover, statement or divider slides
Those slides have no `.slide-body`; they compose content to fill the whole
canvas. Measuring them returns 0mm, which is technically true, useless as a
warning, and actively harmful — it made every deck report "0mm spare" and masked
the genuinely tight content slide. They are excluded from the headroom figure on
purpose. Overflow is still checked on every slide, which is the part that
determines whether the PDF clips.

### Structural and style editing
Blocked deliberately. This tool changes words without touching formatting;
anything else belongs in the HTML, via Claude.

### Script-generated text is read-only
Slide counters and page numbers are written at runtime and have no fixed
counterpart in the source, so they can never be safely written back. The editor
detects this and says so on load. You can still *comment* on them.

### Documents that aren't self-contained
Files referencing CSS, images or fonts by relative path render without them,
because the preview is built from the file's own bytes and has no folder to
resolve against. Editing, commenting and saving are completely unaffected — only
the preview's appearance is. For Switch templates, `make-selfcontained.py` fixes
it, as the skill already instructs.

**Open improvement:** the editor says nothing when this happens, so a document can
render in fallback fonts with a broken logo and the user may not realise the
preview is unfaithful. Both are detectable — failed `document.fonts` entries and
images with `naturalWidth === 0` — so a one-line notice on load is cheap and would
stop "it appears exactly as it will print" being quietly untrue.
