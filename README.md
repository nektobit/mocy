# mocy

mocy is a modern mock REST API server.

It is inspired by [typicode/json-server](https://github.com/typicode/json-server) and aims for drop-in compatibility for common workflows.

## Install

- npm package: [https://www.npmjs.com/package/mocy](https://www.npmjs.com/package/mocy)

```bash
npm i -g mocy
```

Or without global install:

```bash
npm i mocy
npx mocy db.json
```

## Quickstart

```bash
npx mocy db.json
```

Example `db.json`:

```json
{
  "posts": [
    { "id": 1, "title": "Hello" },
    { "id": 2, "title": "World" }
  ],
  "profile": {
    "name": "typicode"
  }
}
```

Example requests:

```bash
curl http://localhost:3000/posts
curl http://localhost:3000/posts/1
curl "http://localhost:3000/posts?_sort=title&_page=1&_per_page=10"
curl -X POST http://localhost:3000/posts -H "content-type: application/json" -d '{"title":"New"}'
```

## SQLite (Transparent)

mocy uses SQLite internally for speed and safety; you still work with `db.json`.

- Input stays `db.json`
- SQLite is stored at `.mocy/mocy.sqlite` by default
- Existing SQLite files with legacy `id_type` schema are auto-migrated
- `db.json` changes are watched and merged automatically by default (`--watch-sync safe`)
- Explicit destructive mode is available with `--watch-sync replace`
- Export current state back to JSON with:

```bash
mocy export db.json
```

## Compatibility

Drop-in replacement for most common workflows; see compatibility notes in [`COMPATIBILITY.md`](./COMPATIBILITY.md).

Important for developers:
- Default ID generation is `safe` (16-hex IDs), which is safer but not json-server-like.
- For strict json-server-like generated IDs, run with `--id-mode compat`.

```bash
mocy db.json --id-mode compat
```

Feature comparison (current status):

| Feature | json-server | mocy (current) | Notes |
| --- | --- | --- | --- |
| `db.json` -> REST API with zero config | Yes | Yes | `mocy db.json` |
| Collection CRUD (`GET/POST/PUT/PATCH/DELETE`) | Yes | Yes | Core happy path supported |
| Item routes (`/:resource/:id`) | Yes | Yes | Supported |
| Singular resources (`/:resource` object) | Yes | Yes | Supported |
| Field filters (`=`, `_lt`, `_lte`, `_gt`, `_gte`, `_ne`) | Yes | Yes | Supported |
| Full-text search (`q`) | Yes (known issues in some versions) | Yes | `mocy` has regression coverage for known `q` cases |
| Sorting (`_sort`, `_order`) | Yes | Yes | Supported |
| Pagination (`_page`, `_per_page`) | Yes | Yes | Response shape aligned to current json-server beta behavior |
| Range (`_start`, `_end`, `_limit`) | Yes | Yes | Supported |
| Route rewrites | Yes | Yes | Via `--routes` |
| Static file serving | Yes | Yes | Via `--static` |
| `_embed` relations | Yes | No (not yet) | Planned |
| Query execution in DB engine | No (lowdb/in-memory) | Yes | List filters/sort/pagination execute via SQL queries |
| Persistence model | JSON file rewritten by server | SQLite internal + optional export | `mocy export db.json` available |
| File watch sync behavior | Watches file | Watches file | Default is non-destructive merge; `--watch-sync replace` is explicit destructive mode |

Supported baseline:

- Collection CRUD (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)
- Item routes (`/:resource/:id`)
- Singular resources (`/:resource` for object values)
- Filters (`field=value`, `_lt`, `_lte`, `_gt`, `_gte`, `_ne`)
- Search (`q`)
- Sorting (`_sort`, `_order`)
- Pagination (`_page`, `_per_page`)
- Range slicing (`_start`, `_end`, `_limit`)
- Route rewrites (`--routes routes.json`)
- Static files (`--static public`)

## ID Generation Modes

For collection `POST` without an explicit `id`:

- Default: `safe` mode generates 16-hex IDs and retries on collisions.
- Compatibility mode: `--id-mode compat` keeps 4-hex json-server-like IDs.

If a client provides an already existing `id`, mocy returns `409` with a duplicate ID error.

## Request Logging

Request logs are off by default. Enable them explicitly:

```bash
mocy db.json --log-requests
```

Log format includes method, path, status and duration (ms).

## MCP Adapter

Official MCP support is delivered as a separate package: `mocy-mcp`.

It is part of the same product line, but physically separated from core `mocy`
to keep REST server releases stable and MCP development independent.

In this repository it lives at `packages/mocy-mcp` and can be started with:

```bash
npx tsx packages/mocy-mcp/src/cli.ts db.json
```

## Why mocy

- Better performance for write-heavy usage (no full JSON rewrite per request)
- Atomic writes and safer concurrent behavior via SQLite transactions
- More predictable query and persistence behavior

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
```

Lockstep release workflow (`mocy` + `mocy-mcp`):

```bash
# 1) bump both package versions together
npm run release:bump -- patch

# 2) generate unified release notes (preview)
npm run release:notes

# optional: generate notes for a specific range [fromRef] [toRef]
npm run release:notes -- v0.2.0 HEAD

# 3) write one entry into CHANGELOG.md
npm run release:notes:write

# 4) run full workspace verification
npm run release:verify
```

Contributing details are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
