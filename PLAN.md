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

## Current status (2026-09-11)

Phases 0-3 and 5 are done and running on the web app. Phase 4 (React Native) has
its groundwork in place but the app itself is not started.

**Verified against the live site**, not just tests:

- Anonymous resolve, paging, and a full profile archive.
- Remote `doc_id` config, loading from a gist and overriding the built-ins.
- Signing in with a pasted cookie export: returns the right handle, and
  **stories load**, which is the thing the login is for.
- Selection mode.
- Folder mode is implemented but **unverified end to end** (Chromium desktop
  only); so is the zip-batch fallback since folder mode became the default.

### Known issues

1. **Reels do not appear when signed in.** Reported after stories started
   working. `fetchReelsPage` has three paths that return `emptyFeed()` — a
   non-OK status, unparseable JSON, and a thrown request — so a failing
   `/api/v1/clips/user/` call is indistinguishable from an account with no
   reels. That swallowing is a defect regardless of the cause, and is the same
   "confident and wrong" pattern `loaded` and the stale-`doc_id` error were
   added to kill. **Fix the reporting first, then read what it actually says.**
   Note reels did work anonymously earlier in the day, so suspect either the
   authenticated headers or a changed endpoint contract.
2. **`doc_id`s rotate often.** They went stale mid-session on 2026-09-11 while
   the app was otherwise working. When anything returns nothing, check the
   error text: a rotation now names this runbook.
3. Notifications (Phase 5 step 7) are unbuilt, and largely moot on the folder
   path since it runs unattended.
4. **`doc_id` rotations need a manual DevTools run every time.** Phase 6 is the
   fix and is prioritised ahead of Phase 4.

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
- [x] **Cut request volume per search.** A search is now two requests: the
      other tabs load when opened, page size is 12, and the multi-page fill is
      a button. Was ~8 requests in a burst.
- [x] **Cut auto-paging to a preview.** `AUTO_PAGES` in `keepsake-app.tsx`
      currently fetches 3 pages per tab on *every* search. Drop to one page of
      previews, load the rest only when the user asks. Fewer requests is both
      better UX and the most effective account-safety measure available.
- [x] **`.npmrc` with `engine-strict=true`** so a friend on Node 20 gets a
      readable error at install time rather than a confusing runtime failure.

---

## Phase 1 — extract a platform-agnostic core — **DONE**

**Goal:** all Instagram knowledge lives in code with zero platform dependencies,
so Phase 4 can move it to React Native untouched.

Done as a pure refactor. `fetch.server.ts` went from 719 lines to 86 and is now
only the web binding: global `fetch`, `process.env`, and the media proxy.
Everything else moved to `src/core/instagram/`, which imports no DOM, no Node
and no framework. The test count went 31 -> 53; the transport seam is what made
the endpoints testable without a network, including an assertion that a search
still costs exactly two requests.

Deviations from the sketch below, all deliberate:

- `normalize/json.ts` was added for the shared defensive readers (`asRecord`,
  `str`, ...) rather than duplicating them per module.
- `client/constants.ts` holds `IG_APP_ID`, the user-agent and `PREVIEW_COUNT`.
- `doc-id.ts` moved into `client/` and lost its `process.env` binding: core
  exposes `loadDocIds`/`memoizeDocIds` and the platform supplies the URL.
- Relative imports inside `core/` carry explicit `.ts` extensions so the modules
  run under bare `node --test`, not only through vite.
- `shortcodeFromHtml` went to `parse.ts`, next to the other text-to-shortcode
  helpers.

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

**Also in this phase:** the cookie jar is now an instance owned by
`InstagramSession`, not a module-level `const`, so Phase 3 can hold one session
per account. A test asserts two sessions do not share cookies.

---

## Phase 2 — split the UI — **DONE**

`keepsake-app.tsx` was 1229 lines holding search, tabs, paging, the grid, the
lightbox and all download logic. It is gone; the composition root is
`src/components/keepsake/index.tsx` at ~160 lines and holds no fetching, no
zipping and no paging. Shipped roughly as sketched below, with these
differences:

- `states.tsx` (loading skeleton, empty tab, resolve error) and `save-link.tsx`
  were added -- small shared pieces the sketch did not name.
- `tab-bar.tsx` and `download-bar.tsx` were split out of `ProfileHeader`, which
  composes them.
- `naming.ts` was split from `zip.ts`: archive file naming is pure, is part of
  what the user keeps, and is now tested directly.
- `lib/serial-queue.ts` is the promise queue that replaced `pagingLock`.
- Tab counts now render only for loaded tabs. The old code showed `0` for a
  deferred tab, which read as "this account has none" rather than "not fetched".

Original sketch:

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

The `pagingLock` busy-wait is gone: opening a deferred tab, "Load more" and
"Load the rest" all go through one `SerialQueue`, so they cannot interleave
requests to Instagram no matter how the user clicks.

---

## Phase 3 — optional authenticated session — **DONE (web)**

Shipped as the external-browser cookie handoff described below. What exists:

- `core/instagram/client/auth.ts` — credential parsing and the
  session-rejected/expired detection. Parsing accepts a bare value, `name=value`,
  a whole `Cookie:` header, or a cookie-extension JSON export, because people
  paste what they have and the alternative is teaching them to edit secrets in a
  text editor.
- `InstagramSession.authenticate()` clears anonymous state first, refuses to
  bootstrap while signed in, ignores cookie-clearing `Set-Cookie` on `sessionid`,
  and enforces a **1200ms minimum gap between authenticated requests** —
  deliberately slower than anonymous, per the rate note below.
- `verifySession()` — one cheap request against the account's own profile.
  Nothing is kept unless Instagram accepts it.
- `POST/GET/DELETE /api/session` and a guided setup panel carrying the warnings.

**Storage, and the one real gap.** Credentials live in the local server
process's memory only: never on disk, never in the repo, never logged, never
sent back to the browser, and not in `localStorage`. A server restart therefore
signs you out. That is deliberate for the web build — the alternative is a
secret at rest with no keystore to put it in. The
`EncryptedSharedPreferences`/Keystore persistence below belongs to Phase 4 and
is **not** done.

**Not built, on purpose:** the WebView login fallback. It stays a fallback.

**Not verified against live Instagram.** Every path is tested against stubs; no
real session has been pasted through this yet.

---

### Original design notes

**Needs the per-instance session from Phase 1.**

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

## Phase 4 — React Native / Expo (optional) — **groundwork done, app not started**

Done, and verifiable without a mobile toolchain:

- `src/core/portability.test.ts` fails the build if `core/` gains a DOM, Node,
  framework or platform import, or loses its explicit `.ts` extensions. Verified
  to actually fire by introducing a violation. Without this the Phase 1
  investment quietly rots — one convenient `window.` is invisible in review.
- **The runtime globals core assumes are now inventoried** in that same test.
  Two need attention on React Native: `AbortSignal.timeout` (absent on older RN
  runtimes — polyfill or drop the timeouts) and `crypto.randomUUID` (absent by
  default, already injectable via `InstagramSession.randomToken`).
- `src/lib/media/source.ts` is the media-URL seam. Components and the zip
  builder no longer construct proxy paths; they ask for `displayUrl` /
  `downloadUrl` / `fetchUrl`. On mobile these become the identity function and
  `/api/media` + `media-url.ts` are deleted.

**Not started: the Expo app itself.** It needs a toolchain that cannot be
verified from here — no Android SDK, no emulator, no way to produce or run an
APK. Scaffolding it would mean writing several hundred lines of code that
nobody has executed, which is the opposite of how the phases above were done.

Remaining work, in order:

1. Restructure to a workspace (`apps/web`, `apps/mobile`, `packages/core`) or
   point Metro at `src/core` directly.
2. `expo-media-library` for save-to-camera-roll behind the existing `share.ts`
   signature.
3. The Android share-target intent filter — the actual reason to do this phase.
4. Swap `media/source.ts` for the identity implementation; delete `/api/*`.

## Original Phase 4 notes

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

## Phase 6 — self-healing doc_ids (do this before Phase 4)

**Why this jumped the queue.** The ids rotated twice in one day on 2026-09-11,
once mid-session while the app was otherwise working. Every rotation currently
costs a DevTools session and a gist edit, and until that happens the app is
simply broken for whoever is holding it. Phase 4 makes the app nicer; this makes
it keep working, which matters more when the thing is sideloaded onto other
people's phones and they cannot fix it themselves.

### The idea

Instagram's own web bundles contain the persisted-query ids, because the web
client has to send them too. We already fetch `instagram.com` for session
verification, and its HTML references the bundles. So the app can read the
current ids out of the site that is rejecting the old ones.

The resolution order becomes:

```
discovered from the live bundles   (new)
  -> KEEPSAKE_DOC_ID_URL gist      (Phase 0)
    -> compiled into the build     (the floor)
```

### Discover lazily, not on startup

Do **not** scrape bundles every launch. Bundles are megabytes and there are
several; doing that on every start is slow, is a lot of traffic, and buys
nothing on the overwhelming majority of runs where the ids are fine.

Instead, hang it off the failure we already detect:

```
StaleDocIdError thrown
  -> discover ids from the bundles
    -> validate
      -> retry the request once
        -> remember for this process
```

That is near-zero cost when things work, and self-healing exactly when they do
not. `assertDocIdAccepted` already identifies the moment precisely, which is
what makes this cheap to add.

### Validate before trusting

A discovered id that is wrong must never silently replace a working one. Run one
cheap query with the candidate and accept it only if the response is not itself
a stale-`doc_id` rejection. A failed discovery then degrades to today's
behaviour — the runbook error — rather than breaking something that worked.

This is the property that makes the whole feature safe to ship, so build the
validation first.

### Finding the right number

The hard part is not finding ids, it is knowing which is which. Use the response
field names as anchors, the same technique `viewerFromHtml` uses: they are
stable, specific, and appear beside the query definition.

| Want | Anchor to search for |
| --- | --- |
| `TIMELINE_DOC_ID` | `xdt_api__v1__feed__user_timeline_graphql_connection` |
| `POST_DOC_ID` | `xdt_api__v1__media__shortcode__web_info` |
| `HIGHLIGHTS_TRAY_DOC_ID` | `edge_highlight_reels` |

Parsing belongs in `core/` as a pure function over bundle text, with fixtures
captured from a real bundle — the same split that made `viewerFromHtml`
testable. Fetching stays in the client layer.

### Honest costs

- **Brittle by nature.** Minified bundles change shape; this will break again.
  It is worth it only because the fallback chain means breaking means "back to
  today", not "worse than today".
- **Bundle size.** Fetch only what is needed and stop at the first match.
- **It is more scraping.** Weigh it against the account-safety posture: it
  happens at most once per process, and only after a failure.

### Done when

A rotation is survived without touching the gist: force a stale id, watch the
app discover, validate, retry and succeed, then confirm the gist is still only
the fallback.

## Starting the next session

Paste this to pick up where the last session left off:

```
Read PLAN.md and PHASE5.md, then do Phase 6 — self-healing doc_ids.

Context: Keepsake is a personal Instagram archiver, local-only, distributed as
a sideloaded APK to a few friends. Never an app store. Node 22.12+ — run
`nvm use` first; the default on this machine is Node 20 and the tests will not
run on it. Set KEEPSAKE_DOC_ID_URL before starting the dev server (see README).
The gist ids may be stale again — if so, that is the problem Phase 6 solves, so
refresh them once by hand to get a working baseline first.

First, a bug: reels do not appear when signed in. fetchReelsPage swallows three
different failures into an empty feed, so it cannot tell "no reels" from "the
request failed". Make it report the difference, then diagnose with what it
says. Do not guess at the cause before that.

Then Phase 6, in order. PLAN.md has the design; the short version:
1. A pure parser in core/ that pulls doc_ids out of bundle text, anchored on
   the response field names, with a fixture captured from a real bundle.
2. Validation: accept a discovered id only if a cheap query with it is not
   itself a stale-doc_id rejection. Build this before wiring anything up — it
   is what stops a bad discovery replacing a working id.
3. Hang discovery off the StaleDocIdError we already raise: discover, validate,
   retry once, remember for the process. Do not scrape bundles on startup.
4. Prove it: force a stale id and watch it recover without touching the gist.

Phase 4 (React Native) comes after. Do not start it in the same session
without telling me first.

Keep `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`
green, and commit each item separately. Say plainly what you have verified
against the live site and what you have only tested.
```

For a different phase, swap the numbered block. Two constraints worth repeating
in any prompt, because they are what kept the earlier phases safe: say
explicitly when something is a pure refactor with no behaviour change, and say
what has *not* been verified against the live site.

## Standing constraints

- Every phase ends green: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build`.
- Keep `isAllowedMediaHost` restrictive for as long as `/api/media` exists — it
  is what stops the proxy being an open relay.
- Do not expose `vite dev` to a network interface. If sharing on a LAN, serve
  the production build (`node .output/server/index.mjs`) instead.
- Scraping Instagram is against their ToS. Fine for a personal tool among
  friends; it is why this never goes to a store or a public repo without thought.
