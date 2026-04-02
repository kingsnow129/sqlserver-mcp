# SQL Server MCP

A minimal MCP server for SQL Server that supports:
- connect / health_check
- list_schemas / list_tables
- describe_table
- query (SELECT only by default)

## 1) Install

```bash
npm install
```

Or run directly after publish:

```bash
npx -y @kingsnow129/sqlserver-mcp@0.1.0
```

## 2) Configure

Copy `.env.example` to `.env` and update values.

Important defaults:
- `DB_READ_ONLY=true` blocks non-SELECT statements
- `DB_MAX_ROWS=200` limits response size

## 3) Run

```bash
npm start
```

The server uses stdio transport, suitable for MCP clients.

## 4) MCP Client Config (example)

Use your MCP client to launch this server command:

```bash
npx -y @kingsnow129/sqlserver-mcp@0.1.0
```

## Tools

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

## Safety

- Query tool enforces single SELECT statement
- Semicolons are blocked to reduce multi-statement risk
- Row limits are enforced on returned records
