# Snag list

Running list of known issues and things deliberately left out. Newest first.

## Fixed

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

### Comments must be anchored inside a single text node
A comment is anchored by its quoted text, so the selection has to sit within one
text node. Selecting across an inline boundary — from a `<strong>` lead-in into
the sentence after it — offers no Comment button. In practice you comment on the
sentence, which is the useful unit, but the silence is unexplained. It should say
why rather than simply not appearing.

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
Files referencing external CSS, images or fonts by relative path will render
without them. Run `make-selfcontained.py` first, as the skill already instructs.
