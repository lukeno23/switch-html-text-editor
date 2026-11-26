# Snag list

Running list of known issues and things deliberately left out. Newest first.

## Fixed

### Save overwrote whatever had changed on disk since the file was opened
*Found and fixed 26 Nov 2026, by simulating the intended round trip.* The editor
kept the source it loaded and wrote that, plus the user's edits, on save. The
workflow it exists for is: comment, Claude edits the file, come back. With the tab
left open, one word changed and saved afterwards silently threw away everything
Claude had done. Nothing compared the file on disk with the one loaded.

Save now reads the file first and refuses if it has changed, offering the new
version instead. The editor also watches the file while it is open (every 2s while
visible, and on focus): with nothing unsaved it reloads by itself, keeping the
scroll position and slide; with unsaved work it asks, then carries edits and new
comments across. An edit is re-applied only where the text it replaced still exists
in the new version, in the same position among identical copies — anything else is
listed under Changes for the user to retype, never guessed.

### Selecting a sentence and typing over it was refused
*Found 26 Nov 2026; probably the bug users actually hit most.* Select every
character of a text node and type, and Chrome doesn't edit the node — it removes it
and inserts a new one. The integrity check saw an unknown node and restored the
element: "That change was undone because it altered the document structure". A
triple-click went wrong a different way: the selection runs to the start of the
next block, so the guard refused it as crossing nodes (left alone, the browser would
have merged the two paragraphs).

`reconcile()` now adopts a new text node that stands where a mapped one was
removed — same element, or a fresh copy of the same formatting element the browser
recreated (`<strong>` for `<strong>`, `<b>` accepted for it). The guard clamps a
selection that only *looks* wider than one run to the run it really covers and
re-issues the edit through `execCommand`, which keeps the undo stack.

### Deleting all of a run's text left it in the file
*Found 26 Nov 2026.* The mirror image of the above. Delete every character of a run
and Chrome removes the text node — and a `<strong>` that held it — without replacing
them. The integrity check only looked for *unknown* nodes, so a *missing* one went
unnoticed, the edit was never recorded, and the run stayed in the saved file: a
paragraph blank on screen with Save disabled, or a bold lead-in gone from the screen
but still in the PDF. `textNodesOf()`'s `trim()` filter made it worse by also hiding
a run edited down to whitespace.

`reconcile()` now reads every run under the edited element back from scratch on
each input; a run whose node is gone is recorded as emptied, so the file gets an
empty `<strong></strong>` where the screen shows nothing. Typing into an emptied
element is allowed and adopted into its run. NBSPs the browser inserts to keep a
space visible are turned back into ordinary spaces unless the run already used
them, so deleting a lead-in no longer rewrites the next run's leading space.

### The overflow list crashed whenever anything overflowed
*Found 26 Nov 2026; in every release since 20 Aug.* The foldable-panel change gave
each section a `.bar` header for its count chip — except the layout section, whose
heading was never wrapped. `setTally()` threw on it, so every overflowing document
showed the red pill but never the list or its Show me links, and because it threw
inside `wire()`, the user was told "The preview could not be prepared for editing"
on opening and after every save. Editing still worked, which is why it went
unnoticed. Layout errors are now caught inside `wire()` so they can never do that
again, and the list lives in the new Checks tab.

### "Copy brief for Claude" pointed Claude at comments that weren't saved
*Found 26 Nov 2026.* The brief says the comments are stored in the file; it was
copied without saving. Pasted straight to Claude, it sent Claude looking for
comments that weren't there — and when Claude then edited the file, the user's next
save hit the overwrite bug above. Copy brief now saves first and refuses to copy if
the save doesn't happen.

### Every save jumped back to the start
*Found 26 Nov 2026.* Saving rebuilt the preview from the new source, which reset the
scroll position and sent a deck back to slide 1, and the load message replaced the
"Saved" toast almost immediately. The view (scroll, zoom, slide, scroll-mode) is now
captured before any reload and restored after it, using the deck's own next/prev
buttons so its script stays in step, and our own reloads don't announce themselves.

### Clearing comments left a stray newline on some hand-built pages
*Found 26 Nov 2026, by the first hand-built page in the fixture set.* The block is
inserted directly before `</body>` with no newline in front; stripping it replaced
the match with a newline unconditionally. On a page ending `</script></body>` that
added one, so "remove every comment and get the file back byte for byte" failed. It
now puts back only the newline the block took with it.

The same sweep found two engine-adjacent smaller ones: a `<div>` holding only
`&nbsp;` was locked as "generated text", because JavaScript's `\s` and `trim()`
count NBSP as whitespace while the browser keeps the node (scanner and DOM now both
use HTML's own whitespace); and a review block Claude wrote with `json.dumps` was
rewritten in the editor's layout on every save, even with no comment changed (it is
now left alone unless a comment changes).

### The fixture test assumed a document nobody had reviewed yet
*Found and fixed 24 Aug 2026, by testing a document that had already been through
the editor.* The real-document test asserts "write a review block, clear it, and
the file comes back byte-for-byte". A file that has been reviewed already carries a
block of its own, so clearing every comment correctly returns the original *minus*
that block, and the test failed on a document where nothing was wrong.

The engine was right throughout — rewriting the file's own eight comments
reproduced it exactly. The test now compares against the document with no block of
its own, and additionally asserts that round trip, which is the property that
matters when someone reopens a reviewed document and saves it again. This is the
same trap the house rules already warn about: assert on what the document actually
carries, not on what the first fixtures happened to look like.

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
looking at. That matches how you would work anyway. (Show me, Find and the Checks
tab do navigate to the right slide since 26 Nov.)

### Typing over a mix of bold and plain text is refused
Since 26 Nov a selection inside ONE run can be typed over even when it looks wider,
and a whole bold phrase can be replaced. A selection covering bold *and* plain text
is still refused: the new text has to go into one run or the other, and either
choice changes formatting the user didn't ask to change.

### Claude marks comments done without saying what it did
Seen on a real reviewed document (Nov 2026): nine comments set to `addressed`, none
with a `response`. The panel says "Marked done, without a note." The brief now asks
for a response explicitly; if it keeps happening, SKILL.md step 6 needs a stronger
line in both skills — bundle that with the next real skill change.

### Stale anchors are flagged, not repaired
If the quoted text changes — you edit it, or Claude rewrites it — the comment is
kept, marked in the panel, and left unhighlighted. It is never silently dropped.
Re-anchoring it to the replacement text would need a similarity match that could
guess wrong, so it is deliberately left to the user to remove or redo.

**Measured on a real reviewed document, 24 Aug 2026:** 3 of 8 comments had gone
stale, and every one of the three was stale *because Claude had addressed it* — it
reworded the quoted sentence, or hyperlinked part of it, which splits the quote
across two text nodes so it can no longer sit in one. So the most common way a
comment gets resolved is also the most reliable way to break its anchor. It does
little harm today, since those threads are answered and their notes and responses
survive intact, but it matters for any feature that wants to point back at text
Claude has already changed — for example, showing the user what was done.

### Headroom is withheld on a page filled to within half a millimetre
`headroomMM()` treats content flush with the box edge (under 0.5mm) as stretched to
fill by design and reports no figure, which is what stops covers and full-bleed
panels claiming to be the tightest page. The cost is that a page *genuinely* filled
that close would drop out of the "tightest" figure too. The closest real page seen
so far left 2mm, so it hasn't happened, and overflow still fires the instant text
spills. Detecting stretch directly — rather than inferring it from flushness — would
remove the ambiguity if it ever misleads anyone.

## Next session

**State as of 26 Nov 2026:** the review-panel / safe-round-trip / find-and-replace
work is shipped (see CHANGELOG). Nothing in either skill needs to change for it: the review block format
and SKILL.md step 6 are untouched.

Tested in Nov: 44 real documents through the node suite (Switch, the second design
system, two client families new to the editor, hand-built pages), and 12 in the
browser, both documents and decks.

What is **still untested**:

- **A typeface the editor cannot lend** (as before).
- ~~Real Chrome, real user~~ — done 26 Nov: in Luke's Chrome with a real file picked
  from disk, real keys (triple-click and type, ⌘Z, Enter and ⌘B refused, ⌘K, ⌘F,
  ⌘S, arrow keys and Space on a deck), the write-permission prompt, Copy brief, and
  Claude editing the file on disk both with and without unsaved work. The only
  thing not driven for real is ⌘\\ — the automation can't send a backslash.

## Proposed upgrades

Still open, in priority order. Three items from the 19 Aug shortlist were built the
same day: Claude writing back into the review block, recent documents, and
collapsible panel sections.

Find and replace, and showing your own edits with a change list, were built on
26 Nov 2026 (see CHANGELOG).

**Worth a spike.**

1. **Print to PDF from the editor.** The templates carry `@page` rules and
   `-webkit-print-color-adjust: exact`, and `generate-pdf.py` drives the same
   Chromium engine. If `frame.contentWindow.print()` matches its output, wording
   changes stop needing Claude or the toolchain. Compare against real
   `generate-pdf.py` output before promising anything.

   **This got more valuable on 24 Aug.** A delivered PDF came back with visibly
   uneven letter spacing — "offers" set as "of fers", a hundred times over — while
   the HTML was perfect. Chromium had snapped every glyph to a whole device pixel,
   which happens with font hinting on and depends on the host's font stack: absent
   on macOS, present in the Linux sandbox where the PDF was generated. The fix is
   `--font-render-hinting=none` on the browser launch. Printing from the editor
   would run on the user's own machine and sidestep the sandbox altogether, so the
   spike now buys fidelity as well as a shorter round trip. Diagnosing it needs no
   special tooling: decompress the PDF's content streams and look at the glyph
   offsets — whole numbers mean snapped, fractional means correct.
2. **`showDirectoryPicker()` for the assets a logo substitute can't cover.** Fonts
   and Switch logos are now lent from the editor's own bundle, which covers every
   broken asset in the ten test documents. A granted folder plus
   `DirectoryHandle.resolve()` would make the preview exact for *any* asset — a
   cover graphic, a photograph — but it costs a permission prompt and picking a
   folder two levels above the document, for a case that hasn't arisen yet.

**Smaller quality-of-life.** Page indicator and jump-to-page for long A4
documents (⌘K to comment shipped 26 Nov).

## Won't fix (by design)

### Deleting a block on a fixed-page template leaves the space empty
Each `.page` is a rigid 210×297mm card and content never reflows between pages —
that is the template's central design decision, and the rule `generate-pdf.py`
enforces. So deleting a paragraph on page 4 leaves a gap on page 4; nothing moves
up from page 5, ever. The deletions panel says this outright and points at the only
thing that can close the gap, which is asking Claude to re-flow the pages.

Flowing documents, which have no page cards, reflow normally — so this is a
property of the template, not a limitation of the editor.

### Headroom is not reported where the figure can't mean anything
Three cases, all deliberate:

- **Slides with no `.slide-body`** — cover, statement and divider slides compose
  content to fill the whole canvas. Measuring them returns 0mm, which is true,
  useless, and harmful: it made every deck report "0mm spare" and masked the
  genuinely tight content slide.
- **Cards whose only children are out of flow** — a running head and a page number
  pinned to the card edges are chrome. Measuring them gave one document a constant
  "9mm spare" on all fifteen pages.
- **Content flush with the box edge** — a flex spacer or full-height wrapper ends
  flush however little it holds, and named covers "tightest".

Overflow is still checked on every card in every case, which is the part that
decides whether the PDF clips. A warning that is always on is one nobody reads.

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
