# Phase 5 — complete archives

Working draft. Supersedes the "Save profile" behaviour, which currently
overpromises: it zips whatever happens to be in memory (one page of posts) and
silently caps at 100 files.

## The problem, measured

A 375-post profile today yields ~12 posts, 4 reels, 0 stories, 0 highlights.
The button says "Save profile".

Three separate causes, worth keeping apart:

1. **Depth.** Nothing pages the timeline before archiving. Cutting auto-paging
   in Phase 0 was right for request volume but nobody taught "Save profile" to
   fetch what it needs.
2. **Caps.** `ZIP_LIMIT = 100` across the whole archive, plus per-tab caps of
   30/24/24/40.
3. **Login.** Stories and highlights are empty logged-out. Working as designed.

## What "complete" actually costs

Worth stating because the earlier estimate was too pessimistic:

| Work | Requests | Risk |
| --- | --- | --- |
| Page 375 posts | ~32 timeline calls | Private API — the sensitive one, but 32 calls spaced out is unremarkable |
| Fetch ~400 media files | ~400 CDN GETs | A CDN serving media. Low. |

So the API traffic is modest. **The binding constraints are memory and the
browser**, not blocking:

- A 100-file zip of reels can be hundreds of MB, built entirely in browser
  memory by JSZip. On a phone that is an out-of-memory crash, not a slow save.
- Browsers block multiple programmatic downloads in a row. Any design that
  emits several zips unattended will silently lose most of them.

Both point the same way: **batch, and let the user tap to take each batch.**

## Design

### An archive job

```
src/core/archive/
  plan.ts     # scope + profile -> ordered ZipEntry[]   (pure)
  batch.ts    # entries -> batches under a size/count budget  (pure)
```

Pure and platform-free, so it lives in `core/`, is directly testable, and ports
to React Native with everything else.

A job runs as a small state machine:

```
idle
  -> collecting     paging each selected tab, spaced      "Posts 156/375"
  -> ready          entries enumerated, batch count known "4 batches, ~380 MB"
  -> packaging(i)   fetching + zipping batch i            "Batch 2: 41/100"
  -> awaiting(i)    zip built, waiting for the user       [Save batch 2]
  -> done | failed | cancelled
```

`awaiting` exists because the browser needs a user gesture per download. That
constraint turns out to be a feature: it paces the whole thing for free and
gives an obvious place to stop.

### Two destinations

Zipping is a workaround for not being able to write files, not a goal. Where
the File System Access API exists, folder mode avoids it entirely: nothing is
held in memory, the directory structure is real, one permission covers the
whole run, and "have I already got this?" is answered by the filesystem rather
than by a list we maintain and hope is right. That is also how the React Native
port will save, so it is the direction of travel rather than a detour.

Zip batching stays for everywhere else, and everything below describes it.

### Batching by size, not just count

Count-based batching is what produces the OOM: 100 photos is ~30 MB, 100 reels
is ~800 MB. Cut a batch when **either** limit is hit:

- ~200 MB estimated, or
- 100 files

Instagram's media URLs carry no size, so the estimate comes from `content-length`
as each file arrives — meaning a batch is closed *during* packaging rather than
planned exactly up front. Batch counts shown before packaging are therefore an
estimate and must be labelled as one.

### Resume

Long archives will be interrupted — a closed tab, a phone sleeping, a stopped
server.

**Do not persist the entry list.** Instagram CDN URLs are signed and expire in
hours; a resumed job replaying yesterday's URLs would fail every fetch and
report a corrupt archive.

Persist instead, in `localStorage` (no secrets involved, so this is safe here in
a way it is not for session cookies):

```json
{ "username": "...", "scope": ["posts","reels"], "saved": ["Cxy1...", "Cxy2..."] }
```

On resume: re-collect from scratch, then skip any shortcode already in `saved`.
Robust to the feed having changed in between, which an index-based cursor is
not. ~5 KB for 375 posts.

### Scope picker

"Save profile" opens a dialog rather than acting immediately:

- Checkboxes: Posts / Reels / Stories / Highlights, each showing what is known
  (`375 posts`, `4 reels`, `stories — needs sign-in`)
- Depth: **Everything** or **First N** (default 120)
- An estimate: "~400 files, 4–5 batches"

Unavailable tabs are shown disabled with the reason, not hidden — "no stories"
and "stories need a login" are different facts.

### Per-tab full download

The existing "Save posts" gets the same treatment: it archives the whole tab,
not just what is loaded. Same job machinery, scope of one.

### Selection

A selection mode on the grid, for "just these three".

- Toggle via a checkbox on each tile; long-press also enters selection mode
- A bar: `12 selected · Save selected · Clear`
- Select-all within the current tab and, on highlights, within the current album
- Selection is per-tab and clears when the profile changes

Selected items skip the collect phase entirely — they are already in memory —
so this is the fast path and worth having for the common case of grabbing a
handful.

### Notifications (optional, last)

When a batch finishes and the tab is backgrounded, a `Notification` is genuinely
useful — these runs take minutes. Ask for permission only when the user starts a
multi-batch job, never on load. Degrade silently if refused.

## Build order

1. **Done.** `core/archive/plan.ts` + `batch.ts` with tests — pure, no UI.
2. **Done.** `use-archive.ts` — the state machine, plus `collectTab` on the
   paging hook so an archive pages through the same queue and spacing as
   everything else.
3. **Done.** Scope dialog + progress. "Save profile" opens it instead of zipping
   whatever happened to be in memory; the old capped path is deleted rather than
   left callable.
4. **Done (better than planned).** Folder mode: where the File System Access
   API exists, files are written straight into a picked folder as
   `username/posts/...` with no zips at all. Duplicates are detected against
   what is on disk, which is a truer record than the shortcode list. Zip
   batches remain the fallback for browsers without it (Firefox, Safari,
   Android Chrome).
5. **Done.** Per-tab full download — "Save all posts" opens the same dialog
   scoped to one tab, so it archives the whole tab rather than what is on
   screen.
6. **Done.** Selection mode — long-press or right-click a tile, or the Select
   button. Selected posts skip collection entirely and go straight to the
   destination picker.
7. Notifications — **not built**, and largely moot on the folder path, which
   runs unattended. Only worth it for the zip fallback.

## Verified, and not

Confirmed against the live site: full-profile archive, per-tab archive, and
selection. Stories load once signed in.

Not verified: folder mode end to end (Chromium desktop only), the zip-batch
fallback now that folder mode is the default, and resume across a reload.

Open: reels return empty when signed in — see Known issues in PLAN.md.

Steps 1–3 are the bug fix. **Not yet verified against a real archive run** —
the batching, resume and save-per-batch paths have only been exercised by
typecheck and the pure tests.

Each step ships green and is independently useful. 1–3 fix the actual bug.

## Open decisions

- Batch budget: 200 MB / 100 files — plausible defaults, unverified on a real
  phone. Wants one real run to calibrate.
- Whether "Everything" should have a hard ceiling as a guard against a 10k-post
  account, or trust the user.
- Auto-continue with a delay, as an option alongside tap-to-save.
