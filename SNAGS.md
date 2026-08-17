# Snag list

Running list of known issues and things deliberately left out. Newest first.

## Fixed

### Spacebar advanced the slide instead of typing a space
*Reported 17 Aug 2026 — fixed same day.*

The Switch presentation template binds `Space`, `ArrowRight` and `PageDown` on
`window` to advance the deck, with no check for whether the caret is in text. So
typing a space jumped to the next slide.

The editor now stops keyboard events reaching the document's own handlers while
the caret is inside editable text. It never calls `preventDefault`, so the
browser still inserts the character — typing wins, navigation doesn't fire.
Arrow keys are contained the same way, so they move the caret rather than the
deck. Slide navigation still works normally when the caret is not in text.

Verified with real keystrokes on a 13-slide client deck: typed `" for Q4 review"`
into the cover heading, three spaces included, and the deck stayed on slide 1.

## Open

### No zoom control
The preview renders at the template's own screen size. A4 pages are 210mm wide,
which can be wider than a laptop viewport, so there is horizontal scrolling on
smaller screens. A zoom slider would need care: CSS transforms can shift the
text caret away from where it is drawn.

### `<title>` is not editable
The document title lives in `<head>` and isn't visible in the preview, so there
is nothing to click. Editing it would need a separate field in the toolbar.

### Live headroom on a title slide shows no measurement
Slide-level headroom is measured from `.slide-body`, which cover and divider
slides don't have. During editing the pill falls back to just the slide count.
The full sweep on load and before saving still reports the tightest slide.

### Live overflow on decks covers only the visible slide
Hidden slides report zero size, so measuring them all requires making them
visible — too disruptive to do on every keystroke, as it would move the caret.
Live checks cover the slide being edited; the full sweep runs on load and again
before saving, so nothing can be saved with an unnoticed overflow.

## Won't fix (by design)

- **Structural and style editing.** Blocked deliberately. This tool exists to
  change words without touching formatting; anything else belongs in the HTML.
- **Script-generated text is read-only.** Slide counters and page numbers are
  written at runtime and have no fixed counterpart in the source, so they can
  never be safely written back. The editor detects this and leaves them alone.
- **Documents that aren't self-contained.** Files referencing external CSS,
  images or fonts by relative path will render without them. Run
  `make-selfcontained.py` first, as the skill already instructs.
