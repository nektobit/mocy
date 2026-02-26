# AI-Friendly DX Roadmap

This roadmap focuses on reducing friction for automation and AI agents that run `mocy` and `mocy-mcp` without manual debugging.

Milestone: [AI-friendly DX hardening](https://github.com/nektobit/mocy/milestone/6)

## MVP

1. [#13 Add machine-readable readiness endpoint: GET /__mocy/health](https://github.com/nektobit/mocy/issues/13)
2. [#14 Add `mocy doctor` command for startup diagnostics](https://github.com/nektobit/mocy/issues/14)
3. [#15 Harden startup error UX (port/file/json/sqlite)](https://github.com/nektobit/mocy/issues/15)

## Next

1. [#16 Add explicit startup readiness signals (`--ready-file` / `--ready-stdout`)](https://github.com/nektobit/mocy/issues/16)
2. [#17 Add `mocy-mcp check <db.json>` smoke-test command](https://github.com/nektobit/mocy/issues/17)
3. [#18 Implement minimal `GET /__mocy/meta` for resource discovery](https://github.com/nektobit/mocy/issues/18)

## Later

1. [#19 Add `mocy init catalog` starter template](https://github.com/nektobit/mocy/issues/19)
