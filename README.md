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
- `db.json` changes are watched and re-imported automatically
- Export current state back to JSON with:

```bash
mocy export db.json
```

## Compatibility

Drop-in replacement for most common workflows; see compatibility notes in [`COMPATIBILITY.md`](./COMPATIBILITY.md).

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

Contributing details are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
