---
description: 'Capturio — 08-02 summary: a short tour of the live bar, built for the user to judge'
type: PlanSummary
about: 'Capturio'
---

# 08-02 SUMMARY — A tour of the bar

> **Outcome:** approved by the user after trying it, and shown once on a fresh install's first launch
> as well as from Help. See `08-04-SUMMARY.md`.

**Status:** ✅ Built and verified 2026-09-27 — **on trial.** The user asked to see it before deciding
whether it stays ("we may not adapt it, but let me see it first").
**Plan:** none; a small, conversational addition on top of 08-01, as agreed in the v0.7 milestone.

## What it is

**Help → Show me around the bar.** Six steps along the *live* bar, each putting a ring on the real
control and a card under the bar:

| # | Points at | Says |
| - | --------- | ---- |
| 1 | the three source buttons | what to record |
| 2 | the two sound switches | independent switches, mixed into one track |
| 3 | record | plus the start/stop and region shortcuts, **only those that work right now** |
| 4 | the whole bar | what it turns into while recording; nothing of it is filmed |
| 5 | settings + recordings | what each opens |
| 6 | hide | how it comes back (tray, and the show/hide shortcut if it works) |

Back / Next / Done, ✕, and the keyboard (← → Esc). **Never shown on first run**, per the user's
earlier decision.

## How

- **`tour:start`** (recordings window → main) brings the bar forward, even when hidden, and sends
  `tour:show`. If the bar is still loading, the request is **held** and collected on mount with
  `tour:take-pending`, the same reasoning as `tellLibrary` — a window being created has no listener.
- **Highlighting is CSS.** Bar elements carry permanent `data-tour` markers; the shell carries
  `data-touring="<step>"`, and one selector per step draws the ring. No per-button tour logic in JSX.
- **The caret is measured**, in a layout effect, from the union of the highlighted elements'
  rectangles, and written to a CSS variable rather than state.
- **Derived end:** `touring = tourStep !== null && !locked`, so a recording started mid-tour (by
  shortcut or tray) ends it; the controls it points at are gone. The saved card is hidden while touring.
- The bar window resizes with the card, as it does for every other card.

## Verified (built app)

Started from a **hidden** bar through the Help link: the bar was shown and focused. Each of the six
steps highlighted the right element with the caret under it (x = 68, 174, 245, 226, 366, 420 px);
step 3 named the live shortcuts; ← went back, Esc ended it and the window returned to 64 px; the last
step's button reads **Done** and ends it. Screenshots were checked by eye. Step 4's first highlight
(border colour only) was too faint and was given the same ring as the others.

## Deferred / for the user

- **Keep, change or remove** — the user's call.
- Launched from **Help only**. The milestone said "Settings and Help"; Settings was left out because
  this project keeps one copy of each control. One line to add if wanted.
