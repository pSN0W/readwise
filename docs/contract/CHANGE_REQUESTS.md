# Contract change requests

Append-only. A ticket that needs the contract, a schema, `packages/core` or the fixture to change writes an entry here instead of changing them. The main session decides.

Format:
```
## <date> · <ticket> · <short title>
- What: …
- Why: …
- Workaround used meanwhile: …
```

## 2026-09-27 · main session · resolved
- Web: `lib.meta()` loaded content.md → fixed in core (meta-only cache) + byte anchors + `readRange`.
- Web: fixture slide-002400.svg unescaped "&" → fixed in `fixtures/make_fixture.py`.
