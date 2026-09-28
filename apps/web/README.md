# Reading Helper · Web App

A laptop web app that reads the library folder and shows concept cards, source text, and reading state. The backend writes the library; this app reads it and writes only the user's state and notes.

## Commands

Run these from `apps/web/`:

| Command | What |
|---|---|
| `npm install` | Install dependencies (local to `apps/web`) |
| `npm run dev` | Dev server at http://127.0.0.1:5173, library from `.scratch/dev` |
| `npm run build` | Vite production build → `dist/` |
| `npm start` | Production server at http://127.0.0.1:8787 (set `LIBRARY_DIR`) |
| `npm run check` | `svelte-check` type checking |
| `npm test` | Vitest unit tests |
| `npm run e2e` | Playwright end-to-end tests |
| `npm run synth` | Generate synthetic library in `.scratch/synth` |
| `npm run perf` | Measure performance targets against synthetic library |

Node v26 runs `.ts` files directly (type stripping). No separate compile step needed.

## Pointing at a real library

```bash
# Development
LIBRARY_DIR=/path/to/your/library npm run dev

# Production
npm run build && LIBRARY_DIR=/path/to/your/library npm start
```

The server binds to `127.0.0.1` only (not exposed to the network).

## Server routes

All routes are under `/library/`:

| Route | Does | Status codes |
|---|---|---|
| `GET /library/<path>` | A file from `LIBRARY_DIR`; `ETag` + `If-None-Match` → 304; `Range` → 206 | 200, 206, 304, 403, 404, 416 |
| `GET /library/<dir>/?list` | JSON array of file names; hides `*.tmp` and `.syncthing.*` | 200 |
| `PUT /library/state/<device_id>.json` | Atomic write; body must be JSON with matching `device_id` | 204, 400, 403 |
| `PUT /library/notes/<card_id>.md` | Atomic write of a note | 204, 403 |
| `POST /library/inbox/` | Multipart upload into `inbox/` | 200 `{saved: [...]}` |
| `POST /library/inbox/links` | Append http(s) URLs to `inbox/links.txt` | 200 `{added: n}` |
| path with `..`, `\`, NUL, absolute | Refused | 403 |

## Views

| View | Route | File | What |
|---|---|---|---|
| Search | `#/search` | `views/Search.svelte` | Search sources by title, author, URL, keywords |
| Reader | `#/read/<id>` | `views/Reader.svelte` | Contents + Book + Cards, all scroll together |
| Coverage | `#/coverage` | `views/Coverage.svelte` | Visual strips of reading coverage per source |
| Video | `#/video/<id>` | `views/Video.svelte` | Slide timeline + card spans + transcript |
| Focus | `#/focus` | `views/Focus.svelte` | One big card, scope select, keyboard nav |
| Board | `#/board` | `views/Board.svelte` | Kanban board by personal tags, drag to retag |
| Inbox | `#/inbox` | `views/Inbox.svelte` | Topic suggestions from the model; accept/rename/reject |
| Report | `#/report` | `views/Report.svelte` | Ingest quality checks per source |
| Settings | `#/settings` | `views/Settings.svelte` | Copy prompt, device ID, tags, theme |
| Palette | Ctrl+K | `components/Palette.svelte` | Search everything: sources, cards, topics, tags |

Global: polls `lib.hasUpdate()` every 10 s → banner "New cards arrived · Reload".

## Performance

Measured on the synthetic library (50 sources, 5,000 cards, one 15,000-line source with 400 images):

| Target | Limit | Measured |
|---|---|---|
| First screen after server start | < 1 s | **420.2 ms** (server up in 85.3 ms) |
| W2 opens the 15,000-line source | < 500 ms | **178.9 ms** first time, 66.8 ms cached |
| W2 scroll (book pane) | 60 fps (p95 < 17 ms) | **60 fps** avg (p95 frame 17.8 ms, 0 frames >20 ms) |
| W2 scroll (cards pane) | 60 fps | **60 fps** avg (p95 frame 18.5 ms) |
| Search per keystroke | < 50 ms | **16.7 ms** avg, 19.9 ms max (core 1 ms) |
| Palette (searchAll) per keystroke | — | **15.7 ms** avg, 16.8 ms max |
| Focus view: content.md for first 10 cards | < 100 KB | **84.4 KB** (using HTTP Range requests) |

Full report saved in `perf-results/perf.json`. All limits met.

## Known limits

- The server binds to localhost only. Not designed for multi-user or remote access.
- No authentication; anyone on the same machine can read/write.
- SVG assets with unescaped `&` (e.g. "Q&A") may not render in some browsers (fixture issue, not ours to fix).
- Range reads require anchors in `meta.json`; sources without anchors fall back to loading the whole `content.md`.
- No offline support (the server must be running).
