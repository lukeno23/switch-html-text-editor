# Changelog

What shipped, when, and in which commit. Newest first. Every push to `main`
deploys, so each dated entry is a release.

`SNAGS.md` holds the reasoning behind each fix — *why* a bug happened and what it
taught — and this file points to it rather than repeating it. `CLAUDE.md` holds
the invariants the fixes had to respect.

The editor shares a contract with the `switch-documents` skill (step 5 links here;
step 6 reads and writes the review block), so skill releases that touched that
contract are noted against the entry they belong to. A second document skill, for
another brand, uses the editor too and links to the same URL.

---

## 23 September 2026 — documentation catch-up

No behaviour changes. One code comment corrected.

- Added this changelog, reconstructed from the full commit history.
- **Corrected a safety claim.** The 0.5mm "flush" threshold in `headroomMM()` was
  justified by "the tightest genuinely-flowing card leaves 17mm". A real page on
  24 Aug left 2mm — still four times the threshold, but the margin is far thinner
  than documented. The comment in `index.html`, `CLAUDE.md` and a new `SNAGS.md`
  entry now say so, and what a closer page would do.
- `CLAUDE.md`: the skills are at v1.4, not v1.3; the editor's URL is now a
  dependency of **two** skills, not one; invariant 6 reworded for documents that
  already carry a review block; a short section on the PDF-spacing fault, which is
  not the editor's but shows up as an editor complaint.
- `SNAGS.md`: "Next session" brought up to date; the stale-anchor entry records how
  often Claude's own fixes break anchors; the headroom won't-fix covers all three
  reasons headroom is withheld.
- `README.md`: paste is converted to plain text, not blocked; overflow measurement
  described as it now works; the tested scope widened beyond the Switch templates.
- `CLAUDE.md` testing traps: the browser caches `index.html`, so a plain reload can
  make a working fix look broken — load `index.html?v=N`.

*Companion kit, same day:* the v1.4 release had left the Team Guide at v1.3, because
`DISTRIBUTION.md`'s checklist didn't list it. Both fixed; the Guide now also tells
the team not to send a PDF that comes with a letter-spacing warning. The skill
bundle was rebuilt and proved content-identical to the uploaded v1.4, so nothing
needed re-uploading.

## 24 August 2026 — `d7e540e`

**The fixture test assumed nobody had reviewed the document yet.** On a file that
had been through the editor, the real-document test failed while the engine was
correct. The test now compares against the document minus its own review block,
and adds the stronger check for such files: rewriting their own comments
reproduces them byte for byte. → SNAGS "The fixture test assumed a document nobody
had reviewed yet".

Also recorded, against the print-to-PDF upgrade, why that spike is now worth more.

*Companion skill v1.4 (same day):* PDFs from both document skills had visibly
uneven letter spacing — Chromium snapping glyphs to whole device pixels in the
Linux sandbox. Fixed with `--font-render-hinting=none`, plus a self-check in
`generate-pdf.py` that warns if it recurs. Not an editor change; the HTML was
always correct.

## 20 August 2026 — `469b5b3`

Found by testing four documents from a second design system. Five bugs, the first
present in every document since the beginning.

- **The preview rendered the source file's own line wrapping.** `plaintext-only`
  editing carries a UA `white-space: pre-wrap` no author rule can override, so a
  paragraph wrapped across lines in the HTML showed as broken lines with hanging
  indents — a third of editable elements differed from the printed page. Now
  `contenteditable="true"`, which renders faithfully; every extra input type it
  allows is refused by the guard, and paste is forced to plain text.
- **Comments came back stale on reopening.** Quotes are captured as rendered text,
  whitespace collapsed; matching raw node data only worked because of the bug
  above. Matching is now whitespace-insensitive on both sides.
- **"0mm spare" on cards laid out to fill themselves** — a cover's spacer, a
  full-bleed panel — named them the tightest in the document.
- **Headroom measured page furniture** on a document with no `.page-body`: a
  constant "9mm spare" on every page, the distance to the page number.
- **Overflow was caught two lines late** on cards with no `.page-body`. Fixed-height
  text boxes are now checked too, so the editor flags at the same point the
  document's own check does.

→ SNAGS, the five entries dated 20 Aug.

## 20 August 2026 — `44c8549`, `2380b9a`, `e0e908f`

- **Claude answers comments in the file** rather than deleting them: `status`
  (`addressed` / `declined`) and `response` persist, answered threads sort below
  open ones in a calmer highlight, and "Copy brief for Claude" carries only open
  threads.
- **Recent documents**, reopened in a click from a handle stored in IndexedDB.
- **The real logotype is lent** to documents whose logo image can't be found, in
  the colour of the background behind it.
- **Foldable panel sections**, each keeping its count chip when collapsed.
- Home screen now says Claude's answers come back in the file.
- Noted the pending test against a second design system.

*Companion skill v1.3:* SKILL.md step 6 rewritten so Claude answers a comment
instead of deleting it; step 5 brought up to date with deletion, `<title>`, zoom
and asset substitution.

## 19 August 2026 — `732ab01` to `76f4867`

The day the editor went from text-only to a review surface, and the day testing
breadth started finding bugs.

- **Review comments** (`732ab01`), stored in one marker-delimited HTML comment
  before `</body>` — invariant 6 — and anchored by quoted text, context and element
  id rather than offsets. Highlighted with the CSS Custom Highlight API.
- **Zoom** with a Fit button, using CSS `zoom` so the caret stays where it's drawn;
  **editable `<title>`**; **full deck sweep** on every keystroke, hidden slides
  included.
- **An unquotable selection explains itself** (`b533b88`) instead of silently
  withholding the Comment button. Fixed a stale `pendingSelection` that could have
  committed a comment against the wrong text.
- **A no-op save rewrote 30 runs** (`6ac3a3a`) — `&middot;` decoded to `·` and
  encoded back literally, so the byte comparison saw a change. The decoded
  comparison was added; both checks are load-bearing. Entity table widened to 166
  names, because an unknown entity locked its whole element read-only. Fit zoom now
  fits the widest page.
- **Commenting on documents without page cards** (`eeb2a64`) — previously the
  button never appeared on any flowing document.
- **Block and section deletion** (`42d83b4`) — invariant 7 — refused wherever the
  closing tag isn't explicit. New home-screen copy.
- **Comments re-anchor on cardless documents** (`df8f98e`), and a `div.page` used as
  a plain wrapper is no longer mistaken for an A4 card.
- **Brand fonts lent** to documents that reference theirs by relative path
  (`c215553`), only where a face actually failed.
- Upgrade shortlist and a pick-up-again note recorded (`76f4867`).

*Companion skill v1.2:* review comments and SKILL.md step 6.

## 17 August 2026 — `dafc96b`, `ded6cd2`

First release. Edits the text of a finished HTML document in its own live preview
and saves back to the same file changing only the bytes that were typed. The
engine records byte offsets of every text run and splices edits into the original
string; it never serializes a DOM. Only render-verified nodes become editable.
Overflow is re-measured live using each template's own test.

Verified on production documents: a no-op round-trip is md5-identical; editing two
paragraphs changed exactly 2 of 880 runs and 0 of 311,930 markup bytes.

`CLAUDE.md` added with the invariants, the source↔preview correlation, and the
house rules.

*Companion skill v1.1:* first org-wide release, linking to the editor at delivery.
