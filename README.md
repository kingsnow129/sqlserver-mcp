# SQL Server MCP

A minimal MCP server for SQL Server that supports:
- connect / health_check
- list_schemas / list_tables
- describe_table
- query (SELECT only by default)

## Copilot Workspace Manifest

This repository now includes a ready-to-use workspace manifest at `.vscode/mcp.json` for VS Code and GitHub Copilot.

It launches the server with:

```json
{
  "servers": {
    "sqlserverMcp": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/src/server.js"],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

This is the recommended configuration for this repository because it is stable on Windows and does not require hardcoding database credentials into source control.

## User-Level Install (Recommended)

If you want this MCP server available across all workspaces, configure it in your user profile instead of `.vscode/mcp.json`.

### Windows quick install

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-user.ps1
```

This installs the package under your user home and creates/updates:
- `%USERPROFILE%\\.mcp-servers\\sqlserver-mcp\\package.json`
- `%USERPROFILE%\\.mcp-servers\\sqlserver-mcp\\.env`
- `%APPDATA%\\Code\\User\\mcp.json` with `servers.sqlserverMcp`

So you no longer need to manually paste MCP config for the default VS Code user profile.

If you want install only without editing user MCP config, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-user.ps1 -SkipUserMcpConfig
```

The script writes this server config when auto-updating user MCP config:

```json
{
  "servers": {
    "sqlserverMcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${userHome}/.mcp-servers/sqlserver-mcp/node_modules/@kingsnow129/sqlserver-mcp/src/server.js"
      ],
      "envFile": "${userHome}/.mcp-servers/sqlserver-mcp/.env"
    }
  }
}
```

### Verify in Command Palette

After running the installer:
- `Ctrl+Shift+P` -> `MCP: List Servers`
- Select `sqlserverMcp`
- You can see status and actions like Start/Stop/Restart and Show Output (logs)

This gives you user-level MCP visibility and management from Command Palette instead of workspace-only setup, while keeping one env source at `%USERPROFILE%\\.mcp-servers\\sqlserver-mcp\\.env`.

## Optional: Dedicated Command Entries via VSIX

If you want your own command names in `Ctrl+Shift+P` (instead of only built-in `MCP:*` commands), use the extension in `vscode-extension/`.

After installing that VSIX, these dedicated commands are available:
- `SQLServer MCP: Install Or Update (User)`
- `SQLServer MCP: Open Env`
- `SQLServer MCP: Open MCP Server List`
- `SQLServer MCP: Open User MCP Configuration`

Build VSIX:

```bash
cd vscode-extension
npm install
npm run package
```

## 1) Install For This Repository

```bash
npm install
```

Copy `.env.example` to `.env` and update the connection settings.

Then open `.vscode/mcp.json` in VS Code and start the server, or run `MCP: List Servers` and start `sqlserverMcp`.

## 2) Install The Published Package In Another Workspace

Install the package into the target workspace:

```bash
npm install @kingsnow129/sqlserver-mcp@0.2.1
```

Create `.vscode/mcp.json` in that workspace:

```json
{
  "servers": {
    "sqlserverMcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@kingsnow129/sqlserver-mcp/src/server.js"
      ],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

Copy `.env.example` from the package or repository into `.env` and update the values.

## 3) Configuration Notes

Important defaults:
- `DB_READ_ONLY=true` blocks non-SELECT statements
- `DB_MAX_ROWS=200` limits response size
- `DB_ENCRYPT=true` is enabled by default
- `DB_TRUST_SERVER_CERT=true` in `.env.example` is convenient for local SQL Server setups; tighten it for production-like environments

## 4) Run Directly

For local debugging outside Copilot:

```bash
npm start
```

The server uses stdio transport, suitable for MCP clients.

## 5) Copilot Validation

The following validation steps were verified:

- `npm pack --dry-run` includes only the expected runtime files
- `node src/server.js` starts correctly in this repository
- the published package `@kingsnow129/sqlserver-mcp@0.2.1` was installed into a clean directory and successfully answered an MCP `listTools` request
- Copilot-visible tools discovered during validation were `connect`, `health_check`, `list_schemas`, `list_tables`, `describe_table`, and `query`

On this Windows environment, `npx -y @kingsnow129/sqlserver-mcp@0.2.1` did not start reliably, so the manifest intentionally uses a direct `node .../src/server.js` launch instead of the `npx <package>` shorthand.

## 6) Tools

- `connect`
  - Optional overrides: `server`, `port`, `database`, `user`, `password`, `encrypt`, `trustServerCertificate`
- `health_check`
- `list_schemas`
- `list_tables`
  - Optional: `schema`
- `describe_table`
  - Required: `table`
  - Optional: `schema` (default: `dbo`)
- `query`
  - Required: `sql`
  - Optional: `params` (object of name/value), `maxRows`

## 7) Safety

- Query tool enforces single SELECT statement
- Semicolons are blocked to reduce multi-statement risk
- Row limits are enforced on returned records
