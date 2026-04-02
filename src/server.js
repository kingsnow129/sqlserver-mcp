#!/usr/bin/env node
import dotenv from "dotenv";
import sql from "mssql";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const TOOL_NAMES = {
  CONNECT: "connect",
  HEALTH_CHECK: "health_check",
  LIST_SCHEMAS: "list_schemas",
  LIST_TABLES: "list_tables",
  DESCRIBE_TABLE: "describe_table",
  QUERY: "query"
};

let pool = null;
let runtimeConfig = null;

function boolFromEnv(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function intFromEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildConfig(overrides = {}) {
  const envConfig = {
    server: process.env.DB_SERVER,
    port: intFromEnv(process.env.DB_PORT, 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: boolFromEnv(process.env.DB_ENCRYPT, true),
      trustServerCertificate: boolFromEnv(process.env.DB_TRUST_SERVER_CERT, false)
    },
    pool: {
      max: intFromEnv(process.env.DB_POOL_MAX, 10),
      min: intFromEnv(process.env.DB_POOL_MIN, 0),
      idleTimeoutMillis: intFromEnv(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30000)
    },
    connectionTimeout: intFromEnv(process.env.DB_CONN_TIMEOUT_MS, 15000),
    requestTimeout: intFromEnv(process.env.DB_REQUEST_TIMEOUT_MS, 15000)
  };

  const merged = {
    ...envConfig,
    ...overrides,
    options: {
      ...envConfig.options,
      ...(overrides.options ?? {})
    },
    pool: {
      ...envConfig.pool,
      ...(overrides.pool ?? {})
    }
  };

  const missing = ["server", "database", "user", "password"].filter((k) => !merged[k]);
  if (missing.length > 0) {
    throw new Error(`Missing SQL Server config fields: ${missing.join(", ")}`);
  }

  return merged;
}

async function closePoolIfAny() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

async function connectPool(overrides = {}) {
  const config = buildConfig(overrides);

  if (pool) {
    await closePoolIfAny();
  }

  pool = await new sql.ConnectionPool(config).connect();
  runtimeConfig = config;

  return {
    connected: true,
    server: config.server,
    database: config.database,
    encrypt: config.options.encrypt,
    trustServerCertificate: config.options.trustServerCertificate
  };
}

async function ensureConnected() {
  if (pool?.connected) {
    return pool;
  }

  if (runtimeConfig) {
    pool = await new sql.ConnectionPool(runtimeConfig).connect();
    return pool;
  }

  await connectPool();
  return pool;
}

function makeTextResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function normalizeIdentifier(input, label) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  const value = input.trim();
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} contains invalid characters.`);
  }

  return value;
}

function getReadOnlyMode() {
  return boolFromEnv(process.env.DB_READ_ONLY, true);
}

function getDefaultMaxRows() {
  return intFromEnv(process.env.DB_MAX_ROWS, 200);
}

function validateQuerySafety(sqlText) {
  const trimmed = String(sqlText ?? "").trim();
  if (!trimmed) {
    throw new Error("sql is required.");
  }

  if (trimmed.includes(";")) {
    throw new Error("Semicolons are not allowed.");
  }

  if (!/^select\b/i.test(trimmed)) {
    throw new Error("Only SELECT statements are allowed.");
  }

  const blockedPatterns = [
    /\b(insert|update|delete|drop|alter|create|truncate|merge|exec|execute|grant|revoke)\b/i,
    /--/,
    /\/\*/
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error("Query contains blocked syntax.");
    }
  }

  return trimmed;
}

async function handleToolCall(name, args = {}) {
  switch (name) {
    case TOOL_NAMES.CONNECT: {
      const overrides = {
        ...(args.server ? { server: args.server } : {}),
        ...(args.port ? { port: Number(args.port) } : {}),
        ...(args.database ? { database: args.database } : {}),
        ...(args.user ? { user: args.user } : {}),
        ...(args.password ? { password: args.password } : {}),
        options: {
          ...(args.encrypt !== undefined ? { encrypt: Boolean(args.encrypt) } : {}),
          ...(args.trustServerCertificate !== undefined
            ? { trustServerCertificate: Boolean(args.trustServerCertificate) }
            : {})
        }
      };

      const result = await connectPool(overrides);
      const dbInfo = await pool.request().query("SELECT @@VERSION AS version");

      return makeTextResult({
        ...result,
        version: dbInfo.recordset?.[0]?.version ?? "unknown"
      });
    }

    case TOOL_NAMES.HEALTH_CHECK: {
      const db = await ensureConnected();
      const started = Date.now();
      const ping = await db.request().query("SELECT 1 AS ok");
      const latencyMs = Date.now() - started;
      return makeTextResult({
        ok: ping.recordset?.[0]?.ok === 1,
        latencyMs
      });
    }

    case TOOL_NAMES.LIST_SCHEMAS: {
      const db = await ensureConnected();
      const result = await db.request().query(`
        SELECT schema_name
        FROM information_schema.schemata
        ORDER BY schema_name
      `);
      return makeTextResult({ schemas: result.recordset });
    }

    case TOOL_NAMES.LIST_TABLES: {
      const db = await ensureConnected();
      const req = db.request();

      let query = `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
      `;

      if (args.schema) {
        const schema = normalizeIdentifier(args.schema, "schema");
        req.input("schema", schema);
        query += " WHERE table_schema = @schema";
      }

      query += " ORDER BY table_schema, table_name";

      const result = await req.query(query);
      return makeTextResult({ tables: result.recordset });
    }

    case TOOL_NAMES.DESCRIBE_TABLE: {
      const db = await ensureConnected();
      const schema = normalizeIdentifier(args.schema ?? "dbo", "schema");
      const table = normalizeIdentifier(args.table, "table");

      const columnsReq = db.request();
      columnsReq.input("schema", schema);
      columnsReq.input("table", table);

      const columns = await columnsReq.query(`
        SELECT
          c.column_name,
          c.data_type,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          c.is_nullable,
          c.column_default,
          c.ordinal_position
        FROM information_schema.columns c
        WHERE c.table_schema = @schema AND c.table_name = @table
        ORDER BY c.ordinal_position
      `);

      const pkReq = db.request();
      pkReq.input("schema", schema);
      pkReq.input("table", table);
      const primaryKeys = await pkReq.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = @schema
          AND tc.table_name = @table
        ORDER BY kcu.ordinal_position
      `);

      const idxReq = db.request();
      idxReq.input("schema", schema);
      idxReq.input("table", table);
      const indexes = await idxReq.query(`
        SELECT
          i.name AS index_name,
          i.is_unique,
          i.is_primary_key,
          c.name AS column_name
        FROM sys.indexes i
        JOIN sys.index_columns ic
          ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c
          ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        JOIN sys.tables t
          ON t.object_id = i.object_id
        JOIN sys.schemas s
          ON s.schema_id = t.schema_id
        WHERE s.name = @schema
          AND t.name = @table
          AND i.is_hypothetical = 0
        ORDER BY i.name, ic.key_ordinal
      `);

      return makeTextResult({
        schema,
        table,
        columns: columns.recordset,
        primaryKeys: primaryKeys.recordset,
        indexes: indexes.recordset
      });
    }

    case TOOL_NAMES.QUERY: {
      const db = await ensureConnected();
      const sqlText = validateQuerySafety(args.sql);

      if (getReadOnlyMode()) {
        validateQuerySafety(sqlText);
      }

      const maxRowsInput = args.maxRows !== undefined ? Number(args.maxRows) : getDefaultMaxRows();
      const maxRows = Number.isFinite(maxRowsInput) && maxRowsInput > 0 ? Math.min(maxRowsInput, 2000) : 200;

      const req = db.request();
      const params = args.params && typeof args.params === "object" ? args.params : {};

      for (const [key, value] of Object.entries(params)) {
        if (!/^[A-Za-z0-9_]+$/.test(key)) {
          throw new Error(`Invalid parameter name: ${key}`);
        }
        req.input(key, value);
      }

      const started = Date.now();
      const result = await req.query(sqlText);
      const latencyMs = Date.now() - started;

      const rows = result.recordset ?? [];
      const limitedRows = rows.slice(0, maxRows);

      return makeTextResult({
        rowCount: rows.length,
        returnedRows: limitedRows.length,
        maxRows,
        latencyMs,
        rows: limitedRows
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  {
    name: "sqlserver-mcp",
    version: "0.2.1"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: TOOL_NAMES.CONNECT,
        description: "Connect to SQL Server with optional runtime overrides.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            port: { type: "number" },
            database: { type: "string" },
            user: { type: "string" },
            password: { type: "string" },
            encrypt: { type: "boolean" },
            trustServerCertificate: { type: "boolean" }
          }
        }
      },
      {
        name: TOOL_NAMES.HEALTH_CHECK,
        description: "Check current SQL Server connection health.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: TOOL_NAMES.LIST_SCHEMAS,
        description: "List available schemas.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: TOOL_NAMES.LIST_TABLES,
        description: "List tables and views, optionally filtered by schema.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {
            schema: { type: "string" }
          }
        }
      },
      {
        name: TOOL_NAMES.DESCRIBE_TABLE,
        description: "Describe table columns, PKs and indexes.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {
            schema: { type: "string" },
            table: { type: "string" }
          },
          required: ["table"]
        }
      },
      {
        name: TOOL_NAMES.QUERY,
        description: "Execute parameterized SELECT query.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string" },
            params: {
              type: "object",
              additionalProperties: true
            },
            maxRows: { type: "number" }
          },
          required: ["sql"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await handleToolCall(request.params.name, request.params.arguments ?? {});
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(async (error) => {
  console.error("Fatal MCP server error:", error);
  await closePoolIfAny();
  process.exit(1);
});

process.on("SIGINT", async () => {
  await closePoolIfAny();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closePoolIfAny();
  process.exit(0);
});
