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
src/components/keepsake-app.tsx  -> all UI state, tabs, downloads, zipping
src/routes/api/resolve.ts   -> POST a query, get a profile or a single post
src/routes/api/profile.ts   -> POST a cursor, get the next page of a tab
src/routes/api/media.ts     -> media proxy (see below)
src/lib/instagram/parse.ts  -> turns pasted text into usernames/shortcodes
src/lib/instagram/fetch.server.ts -> talks to Instagram, normalizes responses
```

Two things are worth knowing before changing any of this:

**The media proxy is not optional.** Instagram's CDN URLs are hotlink-protected
and CORS-blocked, so the browser cannot fetch them directly. Everything routes
through `/api/media`, which refetches server-side with the right `Referer` and
can set `content-disposition: attachment` for downloads. `isAllowedMediaHost`
in `media-url.ts` restricts that proxy to Instagram CDN hosts — keep it that
way, or the endpoint becomes an open relay.

**It depends on Instagram's private API.** `fetch.server.ts` calls internal
GraphQL endpoints using hardcoded `doc_id` constants and a spoofed mobile
user-agent, with a cookie jar bootstrapped from a logged-out session. Meta
rotates those ids without notice. When the app suddenly returns nothing, the
`doc_id`s are the first thing to check — not your code.

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
