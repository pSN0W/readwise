# Prototype guide — how to open it and where each view is

The approved UI prototype (v2) is **`docs/prototype/ui-prototype.html`**. It is one self-contained HTML file with fake data. The user approved it with "all options look good". It shows **look and behaviour**. It is **not** code to copy: its data model (`CARDS` with `src`, `pt`, `state`) is simplified. Real data comes from `@rh/core`.

## Open it

```
# any browser
xdg-open docs/prototype/ui-prototype.html

# or a screenshot at phone size with Playwright (Python is installed)
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1300, "height": 900})
    pg.goto("file:///home/pratyaksh/Documents/personal/projects/reading_helper/docs/prototype/ui-prototype.html")
    pg.wait_for_timeout(800); pg.screenshot(path="/tmp/proto.png", full_page=True); b.close()
EOF
```

The page has: a change list, **5 phone mock-ups** (each works with the mouse), **8 web views** behind tabs, and a picks table (ignore it).

## Its code, split out for reading

| File | Contents |
|---|---|
| `docs/prototype/prototype-data.js` | fake sources, cards, text, helpers (`ref()`, `stateChips()`, `copyCard()`, `promptText()`) |
| `docs/prototype/prototype-views-main.js` | phone views, W2, W9, W14, gestures, tag dropdown, sheets |
| `docs/prototype/prototype-views-web-extra.js` | W6, W7, W10, W11, W12 |

## Where each view is

| View | Function | File : line | What to copy from it |
|---|---|---|---|
| Card tag dropdown | `tagDD(c)` | main : 18 | `<details>` dropdown with checkboxes + "new tag" input + "Stays on this device." |
| Wrong-merge mark | `flagHTML(c)` | main : 14 | only when ≥ 2 sources; label changes to "⚑ Marked as wrong merge · split on next ingest" |
| Note sheet | `noteSheet()` | main : 55 | bottom sheet, textarea, "Saved to c_x.notes.md" |
| Swipe | `attachSwipe()` | main : 70 | horizontal drag after 10 px, threshold 90 px, card rotates dx/45 deg, under-labels "NEXT →" / "← COPY" |
| **P1 Feed** | `buildFeed()` | main : 119 | top bar ‹ · scope select · known; card = path, state chips, tag dropdown, title, WHAT bold line, Why/How/When/Additional, figure, note line, "↓ keep scrolling for the sources", sources with lines, mark button |
| **P2 Books** | `buildBooks()`, `bookFeedHTML()` | main : 159, 147 | list with % bars → Book / Cards switch; ● markers in the text |
| **P3 Tree** | `buildTree()` | main : 182 | Topics / Books switch, breadcrumbs, count + % read bar |
| **P7 Shelf** | `buildShelf()` | main : 197 | my tags as rows, "✎ My notes", copy prompt textarea |
| **P8 Outline** | `buildOutline()` | main : 216 | source select, section headers, concept rows with chips, "N lines with no card" in red if > limit |
| **W2 Reader** | `wReader()` | main : 258 | source chips, pane checkboxes, "⇅ panes scroll together", TOC with sub-items, book with figures in place, cards with actions |
| **W6 Coverage** | `wCoverage()` | extra : 2 | strips, colour key, hatch for gaps |
| **W7 Video** | `wVideo()` | extra : 22 | slide thumbs on a time axis, card spans in 3 rows, transcript |
| **W9 Focus** | `wFocus()` | main : 303 | scope select, ← →, big card with all fields + sources, key hints |
| **W10 Board** | `wBoard()` | extra : 34 | columns per my tag, drag and drop |
| **W11 Inbox** | `wInbox()` | extra : 49 | rows with checkbox, Accept / Rename / Reject, "Combine the ticked tags into:" |
| **W12 Report** | `wHealth()` | extra : 63 | table of checks with ✓ / ⚠ |
| **W14 Palette** | `wPalette()` | main : 324 | overlay, input, list, arrow keys + Enter |

The prototype has **no Search screen** (it was asked for after v2). Build it from the ticket text: it looks like the W14 palette list, but full-page and for sources only (web), or full-screen with the keyboard open (phone).

## Design tokens (both apps already use them)

Colours (light / dark), fonts (Newsreader for titles, Atkinson Hyperlegible for text, JetBrains Mono for labels and line numbers), radius 6–8 px, the red "rule" colour for field labels (WHAT, WHY…), accent blue for links and selection. They are at the top of `ui-prototype.html` (`:root{…}`) and already copied into `apps/web/src/app.css` and `apps/mobile/src/app.css`.
