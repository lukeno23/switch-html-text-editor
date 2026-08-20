# Snag list

Running list of known issues and things deliberately left out. Newest first.

## Fixed

### The preview rendered every wrapped paragraph with the source's line breaks
*Found and fixed 20 Aug 2026, by testing two documents from a new design system —
and it turned out to affect every document, including the ones the editor was
built against.*

Chrome gives `contenteditable="plaintext-only"` a UA `white-space: pre-wrap` that
no author rule can override — not an inline style, not `!important`. So the moment
an element became editable, the *source file's* own line breaks and indentation
started rendering as real line breaks. A paragraph written across four wrapped
lines in the HTML appeared in the preview as four short lines with a hanging
indent, and printed as one flowing paragraph.

It was invisible for months because the templates the editor grew up with write
each paragraph on a single line. Measured across the test set: **31 of 141**
editable elements on the new deck rendered differently from the printed page, 70
of 184 on its A4 companion, and 184 of 806 on an existing Switch document. The
overflow figures were being measured against that inflated text too, so the pill
was answering a question about a document nobody would ever print.

Elements are now made editable with `contenteditable="true"`, which renders
faithfully. Nothing is lost: every input type that `true` additionally permits —
`insertParagraph`, `insertLineBreak`, `formatBold`, `insertFromDrop`, `insertHTML`,
list commands — is absent from `SAFE_INPUT` and refused by `guardInput`, which was
verified by dispatching each one. Paste is forced back to plain text by a handler
that repeats the guard's range check, because `execCommand` does not raise
`beforeinput` and the guard would never see it. All seven test documents now
render identically with and without editing wired up.

### Every comment came back stale on documents whose paragraphs wrap in the source
*Found and fixed 20 Aug 2026, immediately after the fix above.*

A quote is captured with `Selection.toString()`, which reports text **as rendered**
— runs of whitespace collapsed to one space. `findRange()` searched the text nodes'
raw data, which holds whatever the source wrapped and indented. The two only
matched while the `plaintext-only` quirk was rendering the source's line breaks;
with the preview rendering correctly, two of three test comments could not be found
on reopening and came back permanently flagged stale.

Matching is now whitespace-insensitive on both sides: `collapseWhitespace()` builds
the collapsed text of each node plus a map back to raw offsets, so a match still
produces an exact Range. This is what should have been there from the start — it
also survives Claude rewrapping a paragraph while rewriting the document, which
literal matching never could.

### "0mm spare" on any card whose content is laid out to fill it
*Found and fixed 20 Aug 2026.* A cover's flex spacer, a full-bleed colour panel, a
full-height `.stack` wrapper: each ends flush with its content box however little
text it holds. The headroom measurement found their bottom edge, reported 0mm, and
named that card the tightest in the document. Both new documents opened on "tightest
is p1, 0mm spare" when the genuinely tightest page had 45mm to spare — a warning
that is always on is a warning nobody reads.

`headroomMM()` now ignores children that are out of flow, and returns null rather
than a figure when the content sits flush against the box edge. That is the same
judgement already made for cover and divider slides. Overflow is still checked on
every card regardless.

### Headroom measured page furniture on a document with no `.page-body`
*Found and fixed 20 Aug 2026.* One of the new documents lays its pages out with
absolutely positioned `.rh`, `.body` and `.pn` boxes and no `.page-body`. The
measurement fell back to the page itself, found the page number pinned 8mm from the
paper edge, and reported "9mm spare" on all fifteen pages — the same number whatever
the page held. Out-of-flow children are now excluded, so the document reports
"15 pages fit" and claims nothing it cannot measure.

### Overflow was noticed two lines late on cards with no `.page-body`
*Found and fixed 20 Aug 2026.* Same document. Its text box stops 16mm short of the
paper edge, and the editor was watching only the page edge, so text could overrun
its column and collide with the page number while the editor still said the page
fit — 135px past the document's own threshold, which fails that document's build.

Cards that carry a `.page-body` are still measured exactly as their template's own
script measures them, so the editor and `generate-pdf.py` continue to agree. Cards
without one now also check the boxes holding their text, but only those whose height
is fixed by being positioned against both top and bottom: a block with auto height
grows with its text and can never clip it. That restriction is load-bearing — asking
auto-height blocks produced a spill of a few pixels on every heading with tight
line-height, because the letters paint outside the box, and briefly flagged every
cover in the test set as overflowing. The editor now flags the page at the same
point the document's own check does.

### Documents referencing fonts by relative path rendered in a fallback typeface
*Fixed 19 Aug 2026.* Four of ten test documents reference the kit fonts as
`url('../../Switch Design System/fonts/…')`. The preview is built from the file's
bytes and has no folder to resolve against, so those faces failed and the document
rendered in a generic sans — while the home screen claimed "exactly as it will in
the PDF".

The editor now lends the document its own copies of the seven Switch brand faces.
Verified on a real document: DM Sans measurably renders (424px vs 400px for the
fallback at the same size), and on a self-contained document **nothing is
substituted at all** — zero rules injected, embedded fonts untouched, which is the
property that matters. Anything still unresolvable is named in a toolbar pill.

The three faces the editor's own chrome doesn't use — DM Sans italic 400, DM Sans
600, Source Serif 4 600 — are bundled solely so they can be lent to documents.

### Comments never re-anchored on a document without page cards
*Found and fixed 19 Aug 2026, by testing a form mockup and a diagram document.*

`findRange()` skipped any text node without a `.page`/`.slide` ancestor, so on a
flowing document **no comment ever resolved**. It was written to the file and came
back permanently marked stale and unhighlighted. The creation path had been fixed
earlier the same day; the resolution path had not, which is why it looked like it
worked right up to the moment you reopened the file.

The structural filter is gone. Scoring on the quoted text, its surrounding context
and the element id does the disambiguation — the filter was never what made
anchoring accurate. A side effect is that text inside inline SVG can now be
commented on, which matters for diagram-heavy documents.

### A `.page` class that wasn't a page card triggered page logic
*Fixed 19 Aug 2026.* One document uses `.page` for a rounded, content-height
wrapper. The editor read that as a fixed A4 card, reported "1 page fits · 0mm
spare" — meaningless, since the element grows with its content — and offered a
zoom control that did nothing useful.

`looksLikeCards()` now requires a `.page-body`/`.slide-body` content box, or
several cards that clip their overflow. Anything else is treated as a flowing
document: no overflow warnings, which is the safe way to be wrong. The same test
is used for comment and deletion labels, so nothing says "Page 1" about a document
that has no pages.

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

### Deletion is only offered for prose blocks
`DELETABLE_BLOCKS` covers `p`, `li`, `tr`, headings, `blockquote` and friends. On a
form mockup the text lives in `<label>` and `<span>` inside `div.field` wrappers,
so nothing is offered for deletion — the meaningful unit there is the field
wrapper, which needs its own considered design rather than a widened whitelist.
Deletion is the riskiest feature in the tool; broadening what it will remove
deserves a deliberate pass.

### Text inside inline SVG cannot be edited, only commented on
Diagram labels are real document text — one test document holds 118 of them.
They can now be selected, commented on and highlighted, but not edited: SVG
elements have no `contentEditable` property at all, so the browser will not make
them an editing host. Verified directly. Editing them would need a different
mechanism entirely (an overlay input writing back to the run), which is a feature
rather than a fix.

### Comments on a deck need you to navigate to the slide first
Hidden slides cannot be selected, so you can only comment on the slide you are
looking at. That matches how you would work anyway, but there is no way to
comment on a slide from a list view.

### Stale anchors are flagged, not repaired
If the quoted text changes — you edit it, or Claude rewrites it — the comment is
kept, marked in the panel, and left unhighlighted. It is never silently dropped.
Re-anchoring it to the replacement text would need a similarity match that could
guess wrong, so it is deliberately left to the user to remove or redo.

## Next session

**The second design system has been tested** (20 Aug 2026): four documents from it
— a paged A4, a 16:9 deck, a fifteen-page playbook laid out differently again, and
a short flowing report — plus three Switch documents as a regression set. Five bugs
came out of it, all listed under Fixed above, and the biggest one had been present
in every document since the beginning. What was checked and what held:

- Both card shapes are detected correctly. The A4 and the deck carry
  `.page-body`/`.slide-body`; the playbook carries neither and is recognised by its
  overflow-clipping cards instead.
- All four are self-contained, so nothing is substituted and the fidelity pill stays
  quiet. **The "typeface the editor cannot lend" path is therefore still untested** —
  its two typefaces, which the editor does not bundle and could not lend, would be
  the first case if a document of theirs ever arrived without its fonts embedded.
- Editing, comments (create, save, reopen, re-anchor, highlight), deletion of a table
  row and of a section, and byte-identical saves were all verified on the new family.
- `unverifiedElements` is 0 on all four: neither script writes text into the page, so
  there is no equivalent of the Switch deck's slide counter.

Next time, the useful thing is again **a document family nobody has opened here
before**, not more tests on these.

## Proposed upgrades

Still open, in priority order. Three items from the 19 Aug shortlist were built the
same day: Claude writing back into the review block, recent documents, and
collapsible panel sections.

**Build first.**

1. **Find and replace across the document.** The recurring job is "we renamed the
   product / the date changed / the client's name is wrong" — currently 30 manual
   edits or a Claude round-trip. Maps onto the engine as many run edits through the
   well-tested path; show every match before committing.
2. **Show your own edits, and a change list before saving.** Highlighting edited
   runs is nearly free — the Custom Highlight API is already wired for comments —
   and a before/after list plus pending deletions makes a careful save verifiable.

**Worth a spike.**

3. **Print to PDF from the editor.** The templates carry `@page` rules and
   `-webkit-print-color-adjust: exact`, and `generate-pdf.py` drives the same
   Chromium engine. If `frame.contentWindow.print()` matches its output, wording
   changes stop needing Claude or the toolchain. Compare against real
   `generate-pdf.py` output before promising anything.
4. **`showDirectoryPicker()` for the assets a logo substitute can't cover.** Fonts
   and Switch logos are now lent from the editor's own bundle, which covers every
   broken asset in the ten test documents. A granted folder plus
   `DirectoryHandle.resolve()` would make the preview exact for *any* asset — a
   cover graphic, a photograph — but it costs a permission prompt and picking a
   folder two levels above the document, for a case that hasn't arisen yet.

**Smaller quality-of-life.** Page indicator and jump-to-page; ⌘K to comment on a
selection.

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

### Images other than a Switch logo cannot be resolved
Fonts and Switch logos are lent from the editor's own bundle, which covers every
broken asset across the ten test documents. A cover graphic or a photograph at a
relative path still can't be shown — there is nothing generic to lend — and is
named in the toolbar rather than left as a silent gap.

CSS `background-image` at a relative path is also not detected. No test document
uses one, and a failed background load isn't observable the way a failed `<img>` or
`@font-face` is, so it would need parsing the stylesheets to find candidates.
