# Database MCP

Database MCP is an MCP server for SQL Server, PostgreSQL, and MySQL.

It provides tools for:
- `connect`
- `health_check`
- `list_schemas`
- `list_tables`
- `describe_table`
- `query` (single SELECT only)

## Release

Current release:
- NPM package: `@kingsnow129/sqlserver-mcp@0.3.0`
- MCP server name: `database-mcp`
- VSIX helper: `database-mcp-helper@0.3.0`

## What Is New In 0.3.0

- Multi-database profile model (`servers` + `databases`) is now the primary config.
- Automatic profile resolution during `connect`:
  - by `alias`
  - by `serverName`
  - by `host`
  - fallback to `currentServer`, `defaultServer`, then legacy alias
- User install directory moved to:
  - `${userHome}/.mcp-servers/database-mcp`
- VS Code helper command set simplified and includes:
  - `Database MCP: Manage Databases`
  - `Database MCP: Open MCP Server List`
  - `Database MCP: Uninstall (User)`
- Legacy `sqlserverMcp` key is still written for compatibility.

## Quick Start (MCP Config)

Example user/workspace MCP config:

```json
{
  "servers": {
    "databaseMcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${userHome}/.mcp-servers/database-mcp/node_modules/@kingsnow129/sqlserver-mcp/dist/server.js",
        "--profilesFile",
        "${userHome}/.mcp-servers/database-mcp/profiles.json"
      ]
    }
  }
}
```

You can also run directly with NPX:

```json
{
  "mcpServers": {
    "database-mcp": {
      "command": "npx",
      "args": ["-y", "@kingsnow129/sqlserver-mcp"]
    }
  }
}
```

## User-Level Install (Windows)

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-user.ps1
```

This installs to `${HOME}\\.mcp-servers\\database-mcp` and updates `%APPDATA%\\Code\\User\\mcp.json`.

## Profiles Format

`profiles.json` now uses server-level config with database entries:

```json
{
  "defaultServer": "local-server",
  "currentServer": "local-server",
  "currentDatabase": "master",
  "servers": {
    "local-server": {
      "engine": "sqlserver",
      "host": "localhost",
      "port": 1433,
      "integratedAuth": false,
      "user": "sa",
      "password": "",
      "encrypt": true,
      "trustServerCertificate": true,
      "databases": [
        { "name": "master", "readOnly": true, "maxRows": 200 }
      ]
    }
  }
}
```

## VSIX Helper Extension

Build and install locally:

```bash
cd vscode-extension
npm install
npm run package
code --install-extension database-mcp-helper-0.3.0.vsix --force
```

## Safety Defaults

- Read-only mode defaults to `true`
- Query tool only accepts one SELECT statement
- Semicolons are blocked
- Returned rows are capped (default `200`)

## Development

```bash
npm install
npm run build
npm run dev
```

## Publish

NPM publish flow:

```bash
npm run build
npm publish --access public
```

VSIX package flow:

```bash
cd vscode-extension
npm run package
```
