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

- [ ] **Clear `doc_id` failure message.** Detect the rejection shape and surface
      "Instagram changed its internal API — the doc_ids need refreshing (see
      PLAN.md)" instead of a generic error. Highest value per line of code:
      without it, a stale id looks like a bug in working code.
- [ ] **Remote doc_id config.** Fetch the three ids at startup from a URL you
      control (GitHub raw / gist), hardcoded values as fallback. Lets you fix
      every installed APK by editing one text file instead of rebuilding and
      redistributing.
- [ ] **Cut auto-paging to a preview.** `AUTO_PAGES` in `keepsake-app.tsx`
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

**Session acquisition, in order of preference:**

1. **In-app WebView login.** Each user logs into instagram.com in a WebView;
   harvest the session cookie from the WebView cookie store
   (`CookieManager` on Android). No password touches our code, 2FA works
   normally, and it looks like an ordinary login from that device and IP.
   Store in `EncryptedSharedPreferences` / Keystore — never plaintext.
2. **Per-device `cookies.txt` import** into app-private encrypted storage.
   Same security posture if encrypted, but passing credential files around
   creates more chances to leak one.
3. **Never:** one shared account or cookie across the group. Multiple devices
   and IPs on one `sessionid` is a loud bot signal, a single point of failure,
   and hands everyone everyone else's account.

**Two hard rules if the WebView route is built:**

- **Never auto-fill credentials.**
- **Never inject JS into the login page.**

Both turn "unusual" into "unmistakably automated", and both are what would make
this app a credential harvester if the APK leaked or were modified. Note the
inherent tension: being able to read cookies out of a WebView is exactly what
makes a WebView a security concern. Custom Tabs is safer and gives no cookie
access at all — which is why it cannot be used here. Be upfront with anyone you
hand the APK to about what they are trusting.

Expect a one-time new-device checkpoint on first login. That is normal.

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

## Standing constraints

- Every phase ends green: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build`.
- Keep `isAllowedMediaHost` restrictive for as long as `/api/media` exists — it
  is what stops the proxy being an open relay.
- Do not expose `vite dev` to a network interface. If sharing on a LAN, serve
  the production build (`node .output/server/index.mjs`) instead.
- Scraping Instagram is against their ToS. Fine for a personal tool among
  friends; it is why this never goes to a store or a public repo without thought.
