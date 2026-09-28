# Tickets

Three independent tickets. They meet only at the **library folder contract**.

| Ticket | Folder it owns | Status |
|---|---|---|
| [01 · Web app](01-web.md) | `apps/web/` | mostly built; detailed remaining tasks written 27 Sep; agent stopped |
| [02 · Mobile app (Android)](02-mobile.md) | `apps/mobile/` | mostly built; detailed remaining tasks written 27 Sep; agent stopped |
| [03 · Backend ingest](03-backend.md) | `backend/` | design approved 28 Sep; detailed ticket + [config](backend-config.example.yaml) written; not started |

Shared guides for the app tickets: [INPUT_GUIDE.md](INPUT_GUIDE.md) (what the files look like, real values, expected states) and [PROTOTYPE_GUIDE.md](PROTOTYPE_GUIDE.md) (how to open the prototype, where each view is).

## Rules for every ticket

1. **Read first:** [`docs/decisions.md`](../decisions.md) → [`docs/contract/README.md`](../contract/README.md) → [`packages/core/README.md`](../../packages/core/README.md) → your ticket.
2. **Own one folder.** Write only inside your folder. These are **read-only** for every ticket: `docs/`, `packages/core/`, `fixtures/`, `.lavish/`, other apps.
3. **The seam is fixed.** If you believe the contract or `packages/core` must change, do not change it. Append a short entry to `docs/contract/CHANGE_REQUESTS.md` (the one file outside your folder you may append to) and work around it in your folder if you can. Say so in your final report.
4. **Never write into `fixtures/library/`.** For development, copy it to a scratch folder inside your own folder (git-ignored) and point the app there.
5. **Worklog.** Keep `WORKLOG.md` in your folder. Update it at every meaningful step: done / in progress / next / open questions. Someone must be able to resume from it after a crash or a quota reset.
6. **No models, no network at run time** in the UIs. Only the backend calls models, and in development only the mock server.
7. **Tests are part of done.** Unit tests plus a scripted browser run of the main flows. Report exact commands and results. Say plainly if something was not verified.
8. **Look and behaviour** come from the prototype: [`docs/prototype/ui-prototype.html`](../prototype/ui-prototype.html) (open it in a browser; its script is split out in `docs/prototype/prototype-*.js` for reading). The prototype is a **reference**, not code to ship: its data model is simplified. Real data comes from the contract via `@rh/core`.
9. **Plain, short UI text.** Simple English. The user reads fast.
