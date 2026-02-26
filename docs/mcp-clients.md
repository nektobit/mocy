# mocy-mcp Client Setup

`mocy-mcp` exposes read-only tools over stdio.

Base command:

```bash
npx mocy-mcp examples/catalog/db.json
```

Use an absolute path to `db.json` if your MCP client starts from a different working directory.

## Claude Desktop

Config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Example config:

```json
{
  "mcpServers": {
    "mocy": {
      "command": "npx",
      "args": ["-y", "mocy-mcp", "C:\\\\path\\\\to\\\\db.json"]
    }
  }
}
```

## Clients With `mcpServers` JSON

Many clients use the same `mcpServers` shape. Reuse this block:

```json
{
  "mcpServers": {
    "mocy": {
      "command": "npx",
      "args": ["-y", "mocy-mcp", "/absolute/path/to/db.json"]
    }
  }
}
```

## Quick Validation With MCP Inspector

1. Run `npx @modelcontextprotocol/inspector`.
2. Select stdio transport.
3. Set command to `npx`.
4. Set args to `-y mocy-mcp /absolute/path/to/db.json`.
5. Connect and call `mocy_list_resources`.
