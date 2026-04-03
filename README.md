# SQL Server MCP

A minimal MCP server for SQL Server that supports:
- connect / health_check
- list_schemas / list_tables
- describe_table
- query (SELECT only by default)

## Quick Start

### Install from npm (Recommended)

Install the published package:

```bash
npm install @kingsnow129/sqlserver-mcp
```

Then configure `.vscode/mcp.json`:

```json
{
  "servers": {
    "sqlserverMcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@kingsnow129/sqlserver-mcp/dist/server.js"
      ],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

For the simplest setup, use a single connection string in `.env`:

```dotenv
DB_CONNECTION_STRING=Server=localhost,1433;Database=master;User Id=sa;Password=<password>;Encrypt=true;TrustServerCertificate=true
DB_READ_ONLY=true
DB_MAX_ROWS=200
```

If you prefer separate variables, copy `.env.example` to `.env` and fill in `DB_SERVER`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.

The package also accepts install-time flags such as `--connectionString`, `--readOnly`, and `--maxRows`.

**For Windows users:** Use the automated installer script below for hassle-free setup across all workspaces.

### Windows Quick Install (User-Level)

For a one-time setup that works in all VS Code workspaces:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-user.ps1
```

This automatically configures your VS Code user profile without manual file editing.

## Copilot Workspace Manifest

This repository now includes a ready-to-use workspace manifest at `.vscode/mcp.json` for VS Code and GitHub Copilot.

It launches the server with:

```json
{
  "servers": {
    "sqlserverMcp": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/server.js"],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

This is the recommended local configuration for this repository.

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
        "${userHome}/.mcp-servers/sqlserver-mcp/node_modules/@kingsnow129/sqlserver-mcp/dist/server.js"
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

### Configuration model

Prefer `DB_CONNECTION_STRING` for the cleanest install experience.

Supported command-line flags for package-based installs are:
- `--connectionString`
- `--readOnly`
- `--maxRows`

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
npm install @kingsnow129/sqlserver-mcp@0.2.4
```

Create `.vscode/mcp.json` in that workspace:

```json
{
  "servers": {
    "sqlserverMcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@kingsnow129/sqlserver-mcp/dist/server.js"
      ],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

Copy `.env.example` from the package or repository into `.env`, then preferably set `DB_CONNECTION_STRING`.

## 3) Configuration Notes

Important defaults:
- `DB_READ_ONLY=true` blocks non-SELECT statements
- `DB_MAX_ROWS=200` limits response size
- `DB_ENCRYPT=true` is enabled by default
- `DB_TRUST_SERVER_CERT=true` in `.env.example` is convenient for local SQL Server setups; tighten it for production-like environments

## 4) Run Directly

For local debugging outside Copilot:

```bash
npm run dev
```

The server uses stdio transport, suitable for MCP clients.

## 5) Copilot Validation

The following validation steps were verified:

- `npm pack --dry-run` includes only the expected runtime files
- `npm run build` creates `dist/server.js` for runtime and publishing
- the published package `@kingsnow129/sqlserver-mcp@0.2.4` was installed into a clean directory and successfully answered an MCP `listTools` request
- Copilot-visible tools discovered during validation were `connect`, `health_check`, `list_schemas`, `list_tables`, `describe_table`, and `query`

On this Windows environment, direct `node .../dist/server.js` launch remains the most reliable manual fallback in local manifests.

## 6) Tools

- `connect`
  - Optional overrides: `connectionString`, `server`, `port`, `database`, `user`, `password`, `encrypt`, `trustServerCertificate`
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
