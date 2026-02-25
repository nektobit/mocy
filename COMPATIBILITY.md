# Compatibility Notes

mocy targets compatibility with `json-server` common REST flows.

## Current behavior alignment

- IDs are stored and returned as strings for collection items (matching current json-server behavior).
- `--id-mode compat` preserves json-server-like 4-hex generated IDs when compatibility is needed.
- `_page` + `_per_page` responses return pagination metadata with `data` payload.
- `DELETE /:resource/:id` returns the removed item body.

## Known differences (intentional for safety)

- Storage is SQLite-backed internally (`.mocy/mocy.sqlite`) instead of lowdb JSON writes.
- `mocy export db.json` is explicit by default (continuous JSON rewriting is avoided).

If you find a behavior mismatch in a common json-server workflow, please open an issue with a minimal fixture and request/response example.
