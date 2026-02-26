# mocy-playground

Minimal browser playground for exploring any running `mocy` REST API.

This package is versioned independently from core `mocy`.

## Usage

```bash
npx mocy-playground --api http://localhost:3000
```

Options:

- `--api <url>`: target mocy API base URL (default: `http://localhost:3000`)
- `--host <host>`: playground host (default: `127.0.0.1`)
- `--port <port>`: playground port (default: `4173`)

## Development

```bash
npm --workspace packages/mocy-playground run dev -- --api http://localhost:3000
```

Frontend is buildless (vanilla JS + custom `signal` implementation in `public/signal.js`).

## Local Flow

1. Start API: `npx mocy examples/catalog/db.json --port 3000`
2. Start playground: `npx mocy-playground --api http://localhost:3000`
3. Open `http://127.0.0.1:4173` in browser.
