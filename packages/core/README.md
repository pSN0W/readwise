# @rh/core

Shared logic for the web and mobile apps. Zero runtime dependencies, no DOM, no platform APIs.
It implements the read/write side of [the library contract](../../docs/contract/README.md).
Both apps must use it for everything it covers, so the two apps behave the same.

```
npm test            # node --test test/   (runs against fixtures/library)
npm run typecheck   # strict tsc
```

## How an app uses it

1. Implement `LibraryFS` (4 methods: `readText`, `writeText`, `list`, `url`, plus **`readRange(path, startByte, endByte)`** so `lib.lines()` reads only a few KB) for your platform.
2. `const lib = await Library.open(fs)` — loads `library.json`, `cards.json`, suggestions, latest report.
3. `const st = await StateStore.open(fs, deviceId, { resolveId: id => lib.resolveId(id), onChange })`.
4. Render from `lib` + `st`. Poll `lib.hasUpdate()` (e.g. every 10 s, or on app resume); if true, re-open both.

Import it by relative path or an alias (for Vite: `resolve.alias: { "@rh/core": "<repo>/packages/core/src/index.ts" }`). Imports inside use `.ts` extensions; keep `allowImportingTsExtensions` in the app's tsconfig.

## API

| Area | Functions |
|---|---|
| Library | `Library.open(fs)`, `lib.sourceList()`, `lib.source(id)`, `lib.cards` (Map), `lib.cardsInSource(id)` (source order), `lib.cardsInTopic(prefix)`, `lib.resolveId(oldId)`, `lib.hasUpdate()`, `lib.suggestions`, `lib.report`, `lib.url(path)` |
| Text (lazy, cached) | `lib.lines(sourceId, start, end)` (byte-range read between anchors), `lib.allLines(sourceId)` (whole file, for the book view), `lib.meta(sourceId)` (meta.json only, never loads content.md) |
| Location | `pageOf(meta, line)`, `timeOf(meta, line)`, `lineAtTime(meta, t)`, `sectionOf(meta, line)`, `rangeLabel(meta, a, b)`, `formatTime(s)` |
| Book view | `toBlocks(sourceId, lines)` → heading / image / cue / math / code / para blocks, each with its line numbers |
| State | `st.view(card)` → `{status: new/viewed/explored, known, updated, tags, split}`, `st.markViewed(card)` (after `VIEWED_AFTER_MS` = 2 s on screen), `st.markExplored(card)` (after copy), `st.setKnown`, `st.toggleTag`, `st.setTags`, `st.myTags()`, `st.createTag`, `st.deleteTag`, `st.cardsWithTag`, `st.setSplit`, `st.copyPrompt()`, `st.setCopyPrompt`, `st.decideTopic(id, action, path?)`, `st.topicDecisions()`, `st.reloadOthers()`, `st.flush()` |
| Copy for deep dive | `buildDeepDivePrompt(lib, card, st.copyPrompt())` → text for the clipboard |
| Card fields | `cardFields(card)` → present fields in order What, Why, How, When, Additional info |
| Search | `searchSources(lib, q)` (resources: title, author, URL, file name, keywords…), `searchAll(lib, q)` (sources + cards + topics) |
| Topics | `topicTree(cards, topicsOf)`, `cardIdsUnder(node)`, `topicsWithDecisions(card, lib.suggestions, st.topicDecisions())`, `openSuggestions(...)` |
| Coverage | `coverage(lib, sourceId)` → covered %, gaps |
| Notes | `readNote(fs, id)`, `writeNote(fs, id, text)`, `listNotes(fs)` (ids + Syncthing conflict copies), `readNotes(lib, fs, id)` (own note + read-only notes of retired ids merged into it), `retiredInto(lib, id)` |

Pure helpers (`mergeStates`, `viewOf`, `normalizeTag`) are exported for tests.
