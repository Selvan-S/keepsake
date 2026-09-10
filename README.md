# Keepsake

A local tool for archiving public Instagram media. Paste a username, a profile
link, or a post/reel link, and it fetches the media and saves it — single files
or a zip.

Runs entirely on your machine. Nothing is uploaded anywhere.

See [PLAN.md](PLAN.md) for the development roadmap and the `doc_id` runbook.

## Requirements

Node **22.12+** (TanStack Start requires it). If you use nvm:

```sh
nvm use          # reads .nvmrc
```

## Running it

```sh
npm install
npm run dev      # http://127.0.0.1:8080
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `.output/` |
| `npm run preview` | Serve the built output on `:8081` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node's test runner over `src/**/*.test.ts` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## How it works

```
src/routes/index.tsx        -> renders the whole UI
src/components/keepsake/    -> presentational components (composition in index)
src/hooks/                  -> use-resolve / use-profile-paging / use-downloads
src/lib/download/           -> naming, zip assembly, share.ts platform seam
src/routes/api/resolve.ts   -> POST a query, get a profile or a single post
src/routes/api/profile.ts   -> POST a cursor, get the next page of a tab
src/routes/api/media.ts     -> media proxy (see below)
src/core/instagram/          -> all Instagram knowledge, no platform deps
  parse.ts                  -> turns pasted text into usernames/shortcodes
  normalize/                -> GraphQL JSON -> our types (pure)
  client/transport.ts       -> the HttpTransport seam
  client/session.ts         -> cookie jar + anonymous bootstrap
  client/endpoints.ts       -> fetchProfile / fetchProfileTab / resolve
src/lib/instagram/fetch.server.ts -> web binding: global fetch, env, proxy
```

`src/core/` imports no DOM, no Node and no framework: it takes an
`HttpTransport` and never calls `fetch` itself. That is what lets a React Native
port reuse it as-is (Phase 4) and what lets the endpoints be tested against a
stub instead of the live site.

Two things are worth knowing before changing any of this:

**The media proxy is not optional.** Instagram's CDN URLs are hotlink-protected
and CORS-blocked, so the browser cannot fetch them directly. Everything routes
through `/api/media`, which refetches server-side with the right `Referer` and
can set `content-disposition: attachment` for downloads. `isAllowedMediaHost`
in `media-url.ts` restricts that proxy to Instagram CDN hosts — keep it that
way, or the endpoint becomes an open relay.

**It depends on Instagram's private API.** `fetch.server.ts` calls internal
GraphQL endpoints using `doc_id` persisted-query ids and a spoofed mobile
user-agent, with a cookie jar bootstrapped from a logged-out session. Meta
rotates those ids without notice. When the app suddenly returns nothing, the
`doc_id`s are the first thing to check — not your code. A rotation is now
detected and reported as such rather than surfacing as a generic failure.

### Keeping the `doc_id`s current

Every distributed copy freezes at the ids compiled into it, so Keepsake reads
them at startup from a URL you control, falling back to the built-in values if
that is unavailable. Set the URL at build time:

```sh
KEEPSAKE_DOC_ID_URL=https://gist.githubusercontent.com/<you>/<id>/raw/doc-ids.json
```

Create that file yourself — a GitHub gist is enough — with the ids from the
runbook in [PLAN.md](PLAN.md):

```json
{
  "POST_DOC_ID": "27128499623469141",
  "TIMELINE_DOC_ID": "34579740524958711",
  "HIGHLIGHTS_TRAY_DOC_ID": "9957820854288654"
}
```

Use the **raw URL without the revision hash** — the hashed form is frozen at one
version and would defeat the point. Keys may also be written `post`, `timeline`
and `highlightsTray`; a file may specify only the ids that changed. When the ids
rotate, edit that one file and every installed copy recovers without a rebuild.

If `KEEPSAKE_DOC_ID_URL` is unset the app still runs on its built-in ids, but
logs a warning at startup: that copy can only be fixed by rebuilding it.

**A search makes two requests, not eight.** Resolving a profile used to fan out
to the timeline, reels, stories and the highlights tray (which is itself up to
three requests) in one burst, whether or not anyone opened those tabs. Burst
volume from one address is what gets an account or IP blocked, so `fetchProfile`
now does a single timeline request and marks the other tabs `loaded: false`;
they are fetched by `fetchProfileTab` when their tab is opened. "Download
everything" loads the missing tabs first, sequentially, so the zip still means
everything.

Some fields are simply unavailable to logged-out requests (follower counts come
back as `0`, for instance). The UI hides those rather than showing zeroes.

## Scope

Personal, local, single-user. There is no auth, no database, and no rate
limiting, because nothing here is exposed to anyone else. The Instagram session
is one process-global cookie jar — fine for one person on localhost, not fine
if this were ever served to multiple users.

Scraping Instagram this way is against their Terms of Service. That is a
tolerable risk for archiving your own feed on your own machine; deploying it
publicly is a different question entirely.
