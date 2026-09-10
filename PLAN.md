# Keepsake — development plan

Working document. Phases are ordered so each one is independently shippable and
verifiable; do not start a phase before the one above it is green.

## Context and decisions already made

- **Personal tool.** Local-first, single user per instance.
- **Distribution: a signed APK handed to friends.** Never the Play Store or App
  Store — Instagram downloaders get pulled from both. This removes store review
  as a constraint but means *every copy freezes at whatever ships in it*.
- **Node 22.12+** (pinned in `engines`, `.nvmrc`).
- **No backend by choice.** On mobile the server tier disappears entirely (see
  Phase 4). Structure decisions should protect that, not fight it.
- **Auth is opt-in and account-safety-first.** See Phase 3.

## The `doc_id` problem (read before touching `fetch.server.ts`)

Instagram's GraphQL uses *persisted queries*: every query the official client may
run is pre-registered on Meta's servers under a number. The client sends the
number, not the query text. `POST_DOC_ID`, `TIMELINE_DOC_ID` and
`HIGHLIGHTS_TRAY_DOC_ID` are those numbers, lifted from what instagram.com sends.

They go stale whenever Meta redeploys a changed query shape. **When the app
suddenly returns nothing, check these before debugging anything else.**

A rejected id is now detected and reported as such (`src/lib/instagram/doc-id.ts`)
rather than surfacing as "no such profile". The three ids are loaded at startup
from `KEEPSAKE_DOC_ID_URL`, falling back to the values compiled into the build,
so a rotation is fixed by editing that one hosted file — see the README for the
file format.

### Runbook: refreshing the doc_ids

1. Open `instagram.com` in Chrome → DevTools → Network
2. Filter for `graphql/query`
3. Scroll a profile grid → click the request → Payload → copy `doc_id` → that is
   `TIMELINE_DOC_ID`
4. Open a single post → same → `POST_DOC_ID`
5. Open a profile's highlights → `HIGHLIGHTS_TRAY_DOC_ID`

`IG_APP_ID` is the public web client id and rarely changes.

---

## Phase 0 — carry-over quick wins

Small, independent, no restructuring. Do these first.

- [x] **Clear `doc_id` failure message.** Detect the rejection shape and surface
      "Instagram changed its internal API — the doc_ids need refreshing (see
      PLAN.md)" instead of a generic error. Highest value per line of code:
      without it, a stale id looks like a bug in working code.
- [x] **Remote doc_id config.** Fetch the three ids at startup from a URL you
      control (GitHub raw / gist), hardcoded values as fallback. Lets you fix
      every installed APK by editing one text file instead of rebuilding and
      redistributing.
- [x] **Cut auto-paging to a preview.** `AUTO_PAGES` in `keepsake-app.tsx`
      currently fetches 3 pages per tab on *every* search. Drop to one page of
      previews, load the rest only when the user asks. Fewer requests is both
      better UX and the most effective account-safety measure available.
- [ ] **`.npmrc` with `engine-strict=true`** so a friend on Node 20 gets a
      readable error at install time rather than a confusing runtime failure.

---

## Phase 1 — extract a platform-agnostic core

**Goal:** all Instagram knowledge lives in code with zero platform dependencies,
so Phase 4 can move it to React Native untouched.

This is a **pure refactor — no behavior change.** The 18 existing tests must stay
green throughout and are the safety net; add tests for each extracted normalizer
as you go.

`fetch.server.ts` is 704 lines but only 8 of them are `fetch()` calls. The other
~95% is JSON normalization that has no business knowing about the network.

```
src/core/                        # no DOM, no Node, no framework imports
  instagram/
    parse.ts                     # already pure — move as-is
    types.ts                     # move as-is
    normalize/
      post.ts                    # GraphQL post JSON  -> PostResult
      profile.ts                 # profile JSON       -> ProfileResult
      feed.ts                    # timeline/reels     -> ProfileFeed
      highlights.ts              # highlights tray    -> PostResult[]
      media.ts                   # media items, url upgrading
    client/
      transport.ts               # HttpTransport interface   <-- THE SEAM
      session.ts                 # cookie jar + anonymous bootstrap
      graphql.ts                 # doc_ids + query executor
      endpoints.ts               # fetchPost / fetchProfile / fetchProfileTab
```

The seam that makes the mobile port cheap:

```ts
// core/instagram/client/transport.ts
export interface HttpTransport {
  request(url: string, init: RequestInit): Promise<Response>;
}
```

Everything in `core/` takes a transport and never calls `fetch` directly. Web
supplies a Node-side implementation; React Native supplies one backed by native
fetch, and the whole `/api/*` tier stops being necessary.

**Also in this phase:** make the cookie jar an instance owned by the session
rather than a module-level `const`. It is currently process-global, which is
harmless for one user but blocks per-account sessions in Phase 3.

Verify: `npm test`, `npm run typecheck`, and `/api/resolve` still returns a real
profile.

---

## Phase 2 — split the UI

`keepsake-app.tsx` is 1151 lines holding search, tabs, paging, the grid, the
lightbox and all download logic. Split by responsibility, not by size:

```
src/components/keepsake/
  index.tsx                      # composition only, target < 150 lines
  search-bar.tsx
  profile-header.tsx
  tab-bar.tsx
  media-grid.tsx
  media-tile.tsx
  lightbox.tsx
  download-bar.tsx

src/hooks/
  use-resolve.ts                 # the run() orchestration + session ref
  use-profile-paging.ts          # requestMore / fillArchive
  use-downloads.ts               # zip, share, save outcomes

src/lib/download/
  zip.ts                         # JSZip assembly (already reworked)
  share.ts                       # share/download adapter  <-- platform seam
```

Pull state into the hooks so the components stay presentational — that is what
makes them replaceable in Phase 4 while the hooks survive.

`share.ts` is a deliberate seam: web uses the Web Share API and `<a download>`;
mobile swaps in save-to-camera-roll behind the same signature.

While here: replace the `pagingLock` busy-wait poll
(`await sleep(200); continue;`) with a proper promise queue.

---

## Phase 3 — optional authenticated session

**Only start this once Phases 1–2 are done** — it needs the per-instance session
from Phase 1.

**What auth does and does not do.** A session cookie grants exactly what that
account can see in a browser. It does *not* unlock private accounts you do not
already follow. It unlocks stories/highlights (which need login even for public
accounts) and private accounts you already follow.

**Account safety is the design constraint, not a footnote:**

- **Document a secondary/throwaway account as the default**, not as a tip. It
  resolves both the ban risk and the trust question below.
- Cut request rates further when authenticated. Cookie-driven scraping patterns
  are specifically what Meta's detection weights.
- Keep the User-Agent consistent with how the session actually logged in. A
  hardcoded Pixel 8 UA contradicting the real login device is a signal.

### Session acquisition — preferred: external browser + cookie extension

**This is the chosen approach.** The user logs in using a *real browser they
control*, and the app only ever receives an already-minted session cookie.

Setup, done once per person on their own phone:

1. Install **Quetta** (actively maintained, installs extensions from the Chrome
   Web Store and Edge Add-ons) or **Firefox for Android** (official add-on
   support). **Not Kiwi Browser** — archived January 2025, pulled from the Play
   Store, frozen on Manifest V2.
2. Install a reputable open-source cookie extension (e.g. Cookie-Editor) from
   the official store only.
3. Log into instagram.com in that browser.
4. Copy the `sessionid`, `ds_user_id` and `csrftoken` values.
5. Paste into Keepsake's setup screen.

**Why this beats an in-app WebView:** the password never reaches our app at all.
The user types it into a real browser with a real address bar and TLS indicator.
A WebView we own could read every keystroke and inject script into the login
page — that is exactly why Google and Apple ban OAuth in embedded WebViews, and
it is the concern that matters most when handing an APK to friends. It also
means no login flow, no 2FA handling and no checkpoint handling to build: the
browser does all of it, from a normal browser fingerprint on the user's own IP.

**Honest trade-offs:**

- **The extension becomes the trusted component.** A cookie extension can read
  cookies for every site. Install only well-known open-source ones from the
  official store.
- Clunkier than a login button. Mitigate with a guided in-app setup screen that
  walks through the five steps, plus paste-validation with a clear error.
- Clipboard exposure. Android 10+ restricts clipboard reads to the focused app,
  which mitigates most of this; still tell users to clear the clipboard after.
- Sessions expire. Detect a rejected session and prompt to re-paste rather than
  failing opaquely.
- Verify the extension actually works on the current Quetta release — desktop
  extension support does not guarantee mobile behaviour.

**Implementation notes:** store the pasted values in
`EncryptedSharedPreferences` / Keystore, never plaintext, never in the APK,
never in the repo. Validate on paste with one cheap authenticated request.

### Fallbacks, in order

1. **Desktop `cookies.txt` import**, exported by each person on their own
   machine into app-private encrypted storage. Same posture if encrypted, but
   passing credential files around creates more chances to leak one.
2. **In-app WebView login.** More convenient, but our app renders the login form
   and *could* read the password and 2FA codes. Only consider it if the paste
   flow proves too fiddly, and be explicit with users about what they are
   trusting. If built: **never auto-fill credentials** and **never inject JS
   into the login page** — both turn "unusual" into "unmistakably automated",
   and both are what would make this app a credential harvester if the APK
   leaked or were modified.
3. **Never:** one shared account or cookie across the group. Multiple devices
   and IPs on one `sessionid` is a loud bot signal, a single point of failure,
   and hands everyone everyone else's account.

Expect a one-time new-device checkpoint on first login in the browser. Normal.

---

## Phase 4 — React Native / Expo (optional)

Only worth it for the share-target integration: Instagram → Share → Keepsake,
instead of copy-and-paste. That, plus save-to-camera-roll, is the real reason to
go native.

**React Native's fetch is native HTTP — no CORS, arbitrary headers allowed.**
So the entire server tier disappears: no `/api/*`, no media proxy, no hosting.

What moves after Phases 1–2:

| Code | Fate |
| --- | --- |
| `core/` (parse, types, normalize) | Ports verbatim |
| The tests | Port verbatim |
| `core/instagram/client` | New `HttpTransport` impl only |
| `src/hooks/` | Mostly portable — logic, not DOM |
| `src/components/` | Rewritten (RN has no DOM) |
| `media-url.ts`, `/api/*` | Deleted — no proxy needed |

Android-first. Sideloaded APK, no store.

---

## Starting the next session

Paste this to pick up where the last session left off:

```
Read PLAN.md, then work through Phase 0.

Context: Keepsake is a personal Instagram archiver, local-only, distributed
as a sideloaded APK to a few friends. Never an app store. Node 22.12+ —
run `nvm use` first, the default on this machine is Node 20 and the tests
will not run on it.

Phase 0, in order:
1. Detect a stale-doc_id rejection in fetch.server.ts and surface a clear
   error naming the PLAN.md runbook, instead of a generic failure.
2. Fetch the three doc_ids at startup from a remote URL with the current
   hardcoded values as fallback, so a rotation can be fixed without
   rebuilding every APK. Ask me for the URL.
3. Cut AUTO_PAGES in keepsake-app.tsx to a single page of previews, and
   load the rest only on explicit user action.
4. Add .npmrc with engine-strict=true.

Keep `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`
green, and commit each item separately. Do not start Phase 1 in the same
session without telling me first.
```

For a later session, swap the Phase 0 block for the phase you are on. Phase 1 is
a pure refactor — say so explicitly in the prompt, because "no behavior change,
the 18 tests must stay green" is the constraint that keeps it safe.

## Standing constraints

- Every phase ends green: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build`.
- Keep `isAllowedMediaHost` restrictive for as long as `/api/media` exists — it
  is what stops the proxy being an open relay.
- Do not expose `vite dev` to a network interface. If sharing on a LAN, serve
  the production build (`node .output/server/index.mjs`) instead.
- Scraping Instagram is against their ToS. Fine for a personal tool among
  friends; it is why this never goes to a store or a public repo without thought.
