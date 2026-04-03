#!/usr/bin/env node
import {createRequire} from "module";
const _require=createRequire(import.meta.url);
const {version: SERVER_VERSION}=_require("../package.json");
import dotenv from "dotenv";
import sql from "mssql";
import pg from "pg";
import mysql from "mysql2/promise";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema,ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const {Pool: PostgresPool}=pg;

let sqlMsnodesqlv8Cache;

const SUPPORTED_ENGINES=new Set(["sqlserver","postgres","mysql"]);

const CLI_OPTION_MAP={
  target: "target",
  alias: "alias",
  serverName: "serverName",
  defaultAlias: "defaultAlias",
  profilesFile: "profilesFile",
  currentServer: "currentServer",
  currentDatabase: "currentDatabase",
  engine: "engine",
  host: "host",
  connectionString: "connectionString",
  server: "server",
  port: "port",
  database: "database",
  user: "user",
  password: "password",
  integratedAuth: "integratedAuth",
  encrypt: "encrypt",
  ssl: "ssl",
  trustServerCertificate: "trustServerCertificate",
  readOnly: "readOnly",
  maxRows: "maxRows"
};

const TOOL_NAMES={
  CONNECT: "connect",
  HEALTH_CHECK: "health_check",
  LIST_SCHEMAS: "list_schemas",
  LIST_TABLES: "list_tables",
  DESCRIBE_TABLE: "describe_table",
  QUERY: "query"
};

let connection=null;
let runtimeConfig=null;
let runtimeSettings={
  readOnly: true,
  maxRows: 200
};

function parseCliArgs(argv) {
  const parsed={};

  for(let index=0;index<argv.length;index+=1) {
    const token=argv[index];
    if(!String(token).startsWith("--")) {
      continue;
    }

    const rawToken=String(token).slice(2);
    if(rawToken==="help") {
      console.error("Supported flags: --target --alias --serverName --defaultAlias --profilesFile --currentServer --currentDatabase --engine --host --connectionString --server --port --database --user --password --integratedAuth --encrypt --ssl --trustServerCertificate --readOnly --maxRows");
      process.exit(0);
    }

    const equalsIndex=rawToken.indexOf("=");
    const rawName=equalsIndex===-1? rawToken:rawToken.slice(0,equalsIndex);
    const mappedName=CLI_OPTION_MAP[rawName];
    if(!mappedName) {
      continue;
    }

    let value=equalsIndex===-1? undefined:rawToken.slice(equalsIndex+1);
    if(value===undefined) {
      const nextToken=argv[index+1];
      if(nextToken!==undefined&&!String(nextToken).startsWith("--")) {
        value=String(nextToken);
        index+=1;
      } else {
        value="true";
      }
    }

    parsed[mappedName]=value;
  }

  return parsed;
}

const cliOptions=parseCliArgs(process.argv.slice(2));

function boolFromEnv(value,fallback) {
  if(value===undefined) return fallback;
  return String(value).toLowerCase()==="true";
}

function intFromEnv(value,fallback) {
  const parsed=Number.parseInt(String(value??""),10);
  return Number.isFinite(parsed)? parsed:fallback;
}

function firstDefined(...values) {
  return values.find((value) => value!==undefined);
}

function normalizeEngine(input) {
  const normalized=String(input??"sqlserver").trim().toLowerCase();
  if(!SUPPORTED_ENGINES.has(normalized)) {
    throw new Error(`Unsupported DB engine: ${input}. Supported: sqlserver, postgres, mysql.`);
  }
  return normalized;
}

function getProfilesFilePath() {
  return path.resolve(
    firstDefined(
      cliOptions.profilesFile,
      process.env.DB_PROFILES_FILE,
      path.join(os.homedir(),".mcp-servers","database-mcp","profiles.json")
    )
  );
}

function loadProfiles() {
  const profilesPath=getProfilesFilePath();
  if(!fs.existsSync(profilesPath)) {
    return {
      defaultServer: undefined,
      currentServer: undefined,
      currentDatabase: undefined,
      servers: {},
      defaultAlias: undefined,
      aliases: {}
    };
  }

  const raw=fs.readFileSync(profilesPath,"utf8").trim();
  if(!raw) {
    return {
      defaultServer: undefined,
      currentServer: undefined,
      currentDatabase: undefined,
      servers: {},
      defaultAlias: undefined,
      aliases: {}
    };
  }

  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object") {
    return {
      defaultServer: undefined,
      currentServer: undefined,
      currentDatabase: undefined,
      servers: {},
      defaultAlias: undefined,
      aliases: {}
    };
  }

  const servers=parsed.servers&&typeof parsed.servers==="object"? parsed.servers:{};
  const defaultServer=typeof parsed.defaultServer==="string"&&parsed.defaultServer.trim().length>0
    ? parsed.defaultServer.trim()
    : undefined;
  const currentServer=typeof parsed.currentServer==="string"&&parsed.currentServer.trim().length>0
    ? parsed.currentServer.trim()
    : undefined;
  const currentDatabase=typeof parsed.currentDatabase==="string"&&parsed.currentDatabase.trim().length>0
    ? parsed.currentDatabase.trim()
    : undefined;

  const aliases=parsed.aliases&&typeof parsed.aliases==="object"? parsed.aliases:{};
  const defaultAlias=typeof parsed.defaultAlias==="string"&&parsed.defaultAlias.trim().length>0
    ? parsed.defaultAlias.trim()
    : undefined;

  return {defaultServer,currentServer,currentDatabase,servers,defaultAlias,aliases};
}

function normalizeHostForCompare(value) {
  return String(value??"").trim().toLowerCase();
}

function resolveSavedProfile(overrides={}) {
  const profiles=loadProfiles();
  const {servers,aliases}=profiles;

  const requestedTarget=firstDefined(overrides.target,cliOptions.target);
  const matchServerByHost=(hostOrServer) => {
    const wanted=normalizeHostForCompare(hostOrServer);
    return Object.entries(servers).find(([,cfg]) => {
      const hostA=normalizeHostForCompare(cfg?.host);
      const hostB=normalizeHostForCompare(cfg?.server);
      return wanted===hostA||wanted===hostB;
    });
  };

  const requestedAlias=firstDefined(overrides.alias,cliOptions.alias,process.env.DB_ALIAS);
  const requestedServerName=firstDefined(
    overrides.serverName,
    cliOptions.serverName,
    overrides.currentServer,
    cliOptions.currentServer,
    process.env.DB_CURRENT_SERVER
  );
  const requestedHost=firstDefined(overrides.host,overrides.server,cliOptions.host,cliOptions.server,process.env.DB_HOST,process.env.DB_SERVER);

  let source="none";
  let aliasName;
  let serverName;
  let serverProfile;

  if(requestedTarget) {
    const targetKey=String(requestedTarget).trim();
    if(aliases[targetKey]&&typeof aliases[targetKey]==="object") {
      source="target:alias";
      aliasName=targetKey;
      serverProfile=aliases[targetKey];
    } else if(servers[targetKey]&&typeof servers[targetKey]==="object") {
      source="target:serverName";
      serverName=targetKey;
      serverProfile=servers[targetKey];
    } else {
      const foundByTargetHost=matchServerByHost(targetKey);
      if(foundByTargetHost) {
        source="target:host";
        serverName=foundByTargetHost[0];
        serverProfile=foundByTargetHost[1];
      }
    }
  }

  if(requestedAlias) {
    const aliasKey=String(requestedAlias).trim();
    if(aliases[aliasKey]&&typeof aliases[aliasKey]==="object") {
      source="alias";
      aliasName=aliasKey;
      serverProfile=aliases[aliasKey];
    } else if(servers[aliasKey]&&typeof servers[aliasKey]==="object") {
      source="serverName";
      serverName=aliasKey;
      serverProfile=servers[aliasKey];
    }
  }

  if(!serverProfile&&requestedServerName) {
    const key=String(requestedServerName).trim();
    if(servers[key]&&typeof servers[key]==="object") {
      source="serverName";
      serverName=key;
      serverProfile=servers[key];
    }
  }

  if(!serverProfile&&requestedHost) {
    const found=matchServerByHost(requestedHost);
    if(found) {
      source="host";
      serverName=found[0];
      serverProfile=found[1];
    }
  }

  if(!serverProfile&&profiles.currentServer&&servers[profiles.currentServer]) {
    source="currentServer";
    serverName=profiles.currentServer;
    serverProfile=servers[profiles.currentServer];
  }

  if(!serverProfile&&profiles.defaultServer&&servers[profiles.defaultServer]) {
    source="defaultServer";
    serverName=profiles.defaultServer;
    serverProfile=servers[profiles.defaultServer];
  }

  if(!serverProfile) {
    const fallbackAlias=resolveAlias(overrides);
    if(fallbackAlias&&aliases[fallbackAlias]&&typeof aliases[fallbackAlias]==="object") {
      source="defaultAlias";
      aliasName=fallbackAlias;
      serverProfile=aliases[fallbackAlias];
    }
  }

  let dbConfig;
  const requestedDb=firstDefined(
    overrides.database,
    cliOptions.database,
    profiles.currentDatabase,
    process.env.DB_NAME,
    process.env.DB_DATABASE
  );

  if(serverProfile?.databases&&Array.isArray(serverProfile.databases)) {
    if(requestedDb) {
      dbConfig=serverProfile.databases.find((db) => db?.name===requestedDb);
    }
    if(!dbConfig&&serverProfile.databases.length>0) {
      dbConfig=serverProfile.databases[0];
    }
  }

  return {
    source,
    aliasName,
    serverName,
    serverProfile,
    dbConfig
  };
}

function resolveAlias(overrides={}) {
  const explicitAlias=firstDefined(overrides.alias,cliOptions.alias,process.env.DB_ALIAS);
  if(explicitAlias) {
    return String(explicitAlias).trim();
  }

  const defaultFromCliOrEnv=firstDefined(cliOptions.defaultAlias,process.env.DB_DEFAULT_ALIAS);
  if(defaultFromCliOrEnv) {
    return String(defaultFromCliOrEnv).trim();
  }

  return loadProfiles().defaultAlias;
}

function getAliasProfile(alias) {
  if(!alias) {
    return undefined;
  }

  const {aliases}=loadProfiles();
  const profile=aliases[alias];
  if(!profile||typeof profile!=="object") {
    throw new Error(`Alias '${alias}' not found in ${getProfilesFilePath()}`);
  }

  return profile;
}

function getReadOnlyDefault() {
  return boolFromEnv(firstDefined(cliOptions.readOnly,process.env.DB_READ_ONLY),true);
}

function getMaxRowsDefault() {
  return intFromEnv(firstDefined(cliOptions.maxRows,process.env.DB_MAX_ROWS),200);
}

function buildConfig(overrides={}) {
  const resolved=resolveSavedProfile(overrides);
  const {serverProfile,dbConfig}=resolved;

  const engine=normalizeEngine(
    firstDefined(
      overrides.engine,
      cliOptions.engine,
      serverProfile?.engine,
      process.env.DB_ENGINE,
      process.env.DB_TYPE,
      "sqlserver"
    )
  );

  const connectionString=firstDefined(
    overrides.connectionString,
    cliOptions.connectionString,
    serverProfile?.connectionString,
    process.env.DB_CONNECTION_STRING,
    process.env.DATABASE_URL
  );

  const host=firstDefined(
    overrides.host,
    overrides.server,
    cliOptions.host,
    cliOptions.server,
    serverProfile?.host,
    serverProfile?.server,
    process.env.DB_HOST,
    process.env.DB_SERVER
  );

  const port=intFromEnv(
    firstDefined(overrides.port,cliOptions.port,serverProfile?.port,process.env.DB_PORT),
    engine==="sqlserver"? 1433:(engine==="postgres"? 5432:3306)
  );

  const database=firstDefined(
    overrides.database,
    cliOptions.database,
    dbConfig?.name,
    serverProfile?.database,
    process.env.DB_NAME,
    process.env.DB_DATABASE
  );

  const user=firstDefined(overrides.user,cliOptions.user,serverProfile?.user,process.env.DB_USER);
  const password=firstDefined(
    overrides.password,
    cliOptions.password,
    serverProfile?.password,
    process.env.DB_PASSWORD
  );

  const integratedAuth=boolFromEnv(
    firstDefined(
      overrides.integratedAuth,
      cliOptions.integratedAuth,
      serverProfile?.integratedAuth,
      process.env.DB_INTEGRATED_AUTH
    ),
    false
  );

  const config={
    profileSource: resolved.source,
    alias: resolved.aliasName,
    serverName: resolved.serverName,
    engine,
    host,
    port,
    database,
    integratedAuth,
    user: integratedAuth? "":user,
    password: integratedAuth? "":password,
    connectionString,
    // Enforce hard read-only mode regardless of caller overrides.
    readOnly: true,
    maxRows: intFromEnv(firstDefined(overrides.maxRows,dbConfig?.maxRows,serverProfile?.maxRows),getMaxRowsDefault()),
    trustServerCertificate: boolFromEnv(
      firstDefined(
        overrides.trustServerCertificate,
        cliOptions.trustServerCertificate,
        serverProfile?.trustServerCertificate,
        process.env.DB_TRUST_SERVER_CERT
      ),
      engine==="sqlserver"
    ),
    encrypt: boolFromEnv(
      firstDefined(overrides.encrypt,cliOptions.encrypt,serverProfile?.encrypt,process.env.DB_ENCRYPT),
      engine==="sqlserver"
    ),
    ssl: boolFromEnv(
      firstDefined(overrides.ssl,cliOptions.ssl,serverProfile?.ssl,process.env.DB_SSL),
      engine!=="sqlserver"
    )
  };

  const requiredForAuth=integratedAuth? ["host","database"]:["host","database","user","password"];
  const missingWithoutConnString=requiredForAuth.filter((key) => {
    return !config.connectionString&&!config[key];
  });
  if(missingWithoutConnString.length>0) {
    throw new Error(`Missing DB config fields: ${missingWithoutConnString.join(", ")}`);
  }

  return config;
}

function createSqlServerConfig(config) {
  const sharedPool={
    max: intFromEnv(process.env.DB_POOL_MAX,10),
    min: intFromEnv(process.env.DB_POOL_MIN,0),
    idleTimeoutMillis: intFromEnv(process.env.DB_POOL_IDLE_TIMEOUT_MS,30000)
  };

  const sharedTimeouts={
    connectionTimeout: intFromEnv(process.env.DB_CONN_TIMEOUT_MS,15000),
    requestTimeout: intFromEnv(process.env.DB_REQUEST_TIMEOUT_MS,15000)
  };

  if(config.connectionString) {
    const parsed=sql.ConnectionPool.parseConnectionString(config.connectionString);
    return {
      ...parsed,
      ...sharedTimeouts,
      options: {
        ...(parsed.options??{}),
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate
      },
      pool: {
        ...(parsed.pool??{}),
        ...sharedPool
      }
    };
  }

  if(config.integratedAuth) {
    const rawHost=String(config.host??"").trim();
    const hostOnly=rawHost.split("\\")[0];
    const serverEndpoint=config.port
      ? `tcp:${hostOnly},${config.port}`
      : rawHost;

    // msnodesqlv8 is ODBC-based; explicitly setting driver/server format avoids DSN resolution failures.
    return {
      connectionString: [
        "Driver={ODBC Driver 18 for SQL Server}",
        `Server=${serverEndpoint}`,
        `Database=${config.database}`,
        "Trusted_Connection=Yes",
        `Encrypt=${config.encrypt? "Yes":"No"}`,
        `TrustServerCertificate=${config.trustServerCertificate? "Yes":"No"}`
      ].join(";"),
      ...sharedTimeouts,
      pool: sharedPool
    };
  }

  const baseConfig={
    server: config.host,
    port: config.port,
    database: config.database,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate
    },
    pool: sharedPool,
    ...sharedTimeouts
  };

  if(!config.integratedAuth) {
    baseConfig.user=config.user;
    baseConfig.password=config.password;
  }

  return baseConfig;
}

function getSqlServerDriver(config) {
  if(!config.integratedAuth) {
    return {
      module: sql,
      driverName: "tedious"
    };
  }

  if(process.platform!=="win32") {
    throw new Error("SQL Server integratedAuth is only supported on Windows hosts.");
  }

  if(sqlMsnodesqlv8Cache===undefined) {
    try {
      sqlMsnodesqlv8Cache=_require("mssql/msnodesqlv8");
    } catch {
      sqlMsnodesqlv8Cache=null;
    }
  }

  if(!sqlMsnodesqlv8Cache) {
    throw new Error("Integrated auth requires the optional dependency 'msnodesqlv8'. Install it and restart MCP.");
  }

  return {
    module: sqlMsnodesqlv8Cache,
    driverName: "msnodesqlv8"
  };
}

function createPostgresConfig(config) {
  if(config.connectionString) {
    return {
      connectionString: config.connectionString,
      ssl: config.ssl? {rejectUnauthorized: !config.trustServerCertificate}:false
    };
  }

  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl? {rejectUnauthorized: !config.trustServerCertificate}:false
  };
}

function createMysqlConfig(config) {
  if(config.connectionString) {
    return {
      uri: config.connectionString,
      waitForConnections: true,
      connectionLimit: intFromEnv(process.env.DB_POOL_MAX,10),
      ssl: config.ssl
        ? {rejectUnauthorized: !config.trustServerCertificate}
        : undefined
    };
  }

  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: intFromEnv(process.env.DB_POOL_MAX,10),
    ssl: config.ssl
      ? {rejectUnauthorized: !config.trustServerCertificate}
      : undefined
  };
}

async function closePoolIfAny() {
  if(!connection?.client) {
    return;
  }

  try {
    if(connection.engine==="sqlserver") {
      await connection.client.close();
    } else if(connection.engine==="postgres") {
      await connection.client.end();
    } else if(connection.engine==="mysql") {
      await connection.client.end();
    }
  } finally {
    connection=null;
  }
}

function compilePositionalQuery(sqlText,params,style) {
  const values=[];
  const pgIndexByName=new Map();

  const text=sqlText.replace(/@([A-Za-z0-9_]+)/g,(_,name) => {
    if(!(name in params)) {
      throw new Error(`Missing parameter value: ${name}`);
    }

    if(style==="pg") {
      if(!pgIndexByName.has(name)) {
        pgIndexByName.set(name,values.length+1);
        values.push(params[name]);
      }
      return `$${pgIndexByName.get(name)}`;
    }

    values.push(params[name]);
    return "?";
  });

  return {text,values};
}

function normalizeQueryParams(params) {
  if(!params||typeof params!=="object") {
    return {};
  }

  for(const key of Object.keys(params)) {
    if(!/^[A-Za-z0-9_]+$/.test(key)) {
      throw new Error(`Invalid parameter name: ${key}`);
    }
  }

  return params;
}

async function runSelectOne() {
  if(!connection) {
    throw new Error("Not connected.");
  }

  if(connection.engine==="sqlserver") {
    const result=await connection.client.request().query("SELECT 1 AS ok");
    return result.recordset?.[0]?.ok===1;
  }

  if(connection.engine==="postgres") {
    const result=await connection.client.query("SELECT 1 AS ok");
    return result.rows?.[0]?.ok===1;
  }

  const [rows]=await connection.client.query("SELECT 1 AS ok");
  return rows?.[0]?.ok===1;
}

async function runQuery(sqlText,params={}) {
  if(!connection) {
    throw new Error("Not connected.");
  }

  const normalizedParams=normalizeQueryParams(params);

  if(connection.engine==="sqlserver") {
    const req=connection.client.request();
    for(const [key,value] of Object.entries(normalizedParams)) {
      req.input(key,value);
    }
    const result=await req.query(sqlText);
    return result.recordset??[];
  }

  if(connection.engine==="postgres") {
    const compiled=compilePositionalQuery(sqlText,normalizedParams,"pg");
    const result=await connection.client.query(compiled.text,compiled.values);
    return result.rows??[];
  }

  const compiled=compilePositionalQuery(sqlText,normalizedParams,"mysql");
  const [rows]=await connection.client.query(compiled.text,compiled.values);
  return Array.isArray(rows)? rows:[];
}

function parseSqlServerHost(host) {
  const rawHost=String(host??"").trim();
  const parts=rawHost.split("\\");
  const hostOnly=parts[0]??"";
  const instanceName=parts[1]??"";
  return {rawHost,hostOnly,instanceName};
}

function getSqlServerProbePorts(config) {
  const defaults=[1433,1434,1435,1436,1437];
  const envPorts=String(process.env.DB_INSTANCE_PROBE_PORTS??"")
    .split(",")
    .map((value) => Number(String(value).trim()))
    .filter((value) => Number.isInteger(value)&&value>0&&value<=65535);

  const merged=[config.port,...envPorts,...defaults]
    .filter((value) => Number.isInteger(value)&&value>0&&value<=65535);

  return [...new Set(merged)];
}

function serverNameMatchesInstance(serverName,instanceName) {
  if(!serverName||!instanceName) {
    return false;
  }

  return String(serverName).toUpperCase().endsWith(`\\${String(instanceName).toUpperCase()}`);
}

async function connectSqlServerWithFallback(config,sqlDriver) {
  const baseSqlConfig=createSqlServerConfig(config);

  try {
    const client=await new sqlDriver.module.ConnectionPool(baseSqlConfig).connect();
    return {client,resolvedPort: config.port};
  } catch(initialError) {
    const {instanceName,hostOnly}=parseSqlServerHost(config.host);
    const shouldProbe=config.integratedAuth&&instanceName&&!config.connectionString;
    if(!shouldProbe) {
      throw initialError;
    }

    const probePorts=getSqlServerProbePorts(config);
    for(const port of probePorts) {
      let client;
      try {
        const probeConfig={...config,host: hostOnly,port};
        const probeSqlConfig=createSqlServerConfig(probeConfig);
        client=await new sqlDriver.module.ConnectionPool(probeSqlConfig).connect();
        const probeResult=await client.request().query("SELECT CAST(@@SERVERNAME AS nvarchar(256)) AS server_name");
        const serverName=probeResult.recordset?.[0]?.server_name??"";
        if(serverNameMatchesInstance(serverName,instanceName)) {
          return {client,resolvedPort: port};
        }

        await client.close();
      } catch {
        if(client) {
          try {
            await client.close();
          } catch {
            // ignore cleanup failure for probe attempts
          }
        }
      }
    }

    const detail=initialError instanceof Error? initialError.message:String(initialError);
    throw new Error(`Failed to resolve SQL Server instance '${instanceName}' for host '${hostOnly}'. Set explicit port in profile (for example 1434) or configure DB_INSTANCE_PROBE_PORTS. Original error: ${detail}`);
  }
}

async function connectPool(overrides={}) {
  const config=buildConfig(overrides);
  let effectiveConfig={...config};

  await closePoolIfAny();

  if(config.engine==="sqlserver") {
    const sqlDriver=getSqlServerDriver(config);
    const {client,resolvedPort}=await connectSqlServerWithFallback(config,sqlDriver);
    effectiveConfig={...effectiveConfig,port: resolvedPort};
    connection={engine: "sqlserver",client,sqlDriver: sqlDriver.driverName};
  } else if(config.engine==="postgres") {
    const pgConfig=createPostgresConfig(config);
    const client=new PostgresPool(pgConfig);
    await client.query("SELECT 1");
    connection={engine: "postgres",client};
  } else {
    const mysqlConfig=createMysqlConfig(config);
    const client=mysql.createPool(mysqlConfig);
    await client.query("SELECT 1");
    connection={engine: "mysql",client};
  }

  runtimeConfig={...effectiveConfig};
  runtimeSettings={
    readOnly: effectiveConfig.readOnly,
    maxRows: effectiveConfig.maxRows
  };

  return {
    connected: true,
    alias: effectiveConfig.alias,
    serverName: effectiveConfig.serverName,
    profileSource: effectiveConfig.profileSource,
    engine: effectiveConfig.engine,
    sqlDriver: connection?.sqlDriver,
    host: effectiveConfig.host,
    port: effectiveConfig.port,
    database: effectiveConfig.database,
    integratedAuth: effectiveConfig.integratedAuth,
    readOnly: runtimeSettings.readOnly,
    maxRows: runtimeSettings.maxRows
  };
}

async function ensureConnected() {
  if(connection?.client) {
    return connection;
  }

  if(runtimeConfig) {
    await connectPool(runtimeConfig);
    return connection;
  }

  await connectPool();
  return connection;
}

function makeTextResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data,null,2)
      }
    ]
  };
}

function normalizeIdentifier(input,label) {
  if(typeof input!=="string"||input.trim().length===0) {
    throw new Error(`${label} is required.`);
  }

  const value=input.trim();
  if(!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} contains invalid characters.`);
  }

  return value;
}

function getReadOnlyMode() {
  return runtimeSettings.readOnly;
}

function getDefaultMaxRows() {
  return runtimeSettings.maxRows;
}

function validateQuerySafety(sqlText) {
  const trimmed=String(sqlText??"").trim();
  if(!trimmed) {
    throw new Error("sql is required.");
  }

  if(trimmed.includes(";")) {
    throw new Error("Semicolons are not allowed.");
  }

  if(!/^select\b/i.test(trimmed)) {
    throw new Error("Only SELECT statements are allowed.");
  }

  const blockedPatterns=[
    /\b(insert|update|delete|drop|alter|create|truncate|merge|exec|execute|grant|revoke)\b/i,
    /\b(call|declare)\b/i,
    /\b(?:sp_|xp_)[A-Za-z0-9_]*\b/i,
    /\b[A-Za-z0-9_]+\.[A-Za-z0-9_]+\s*\(/i,
    /--/,
    /\/\*/
  ];

  for(const pattern of blockedPatterns) {
    if(pattern.test(trimmed)) {
      throw new Error("Query contains blocked syntax.");
    }
  }

  return trimmed;
}

async function handleToolCall(name,args={}) {
  switch(name) {
    case TOOL_NAMES.CONNECT: {
      const overrides={
        ...(args.target? {target: args.target}:{}),
        ...(args.alias? {alias: args.alias}:{}),
        ...(args.serverName? {serverName: args.serverName}:{}),
        ...(args.engine? {engine: args.engine}:{}),
        ...(args.connectionString? {connectionString: args.connectionString}:{}),
        ...(args.host? {host: args.host}:{}),
        ...(args.server? {server: args.server}:{}),
        ...(args.port? {port: Number(args.port)}:{}),
        ...(args.database? {database: args.database}:{}),
        ...(args.user? {user: args.user}:{}),
        ...(args.password? {password: args.password}:{}),
        ...(args.integratedAuth!==undefined? {integratedAuth: Boolean(args.integratedAuth)}:{}),
        ...(args.maxRows!==undefined? {maxRows: Number(args.maxRows)}:{}),
        ...(args.encrypt!==undefined? {encrypt: Boolean(args.encrypt)}:{}),
        ...(args.ssl!==undefined? {ssl: Boolean(args.ssl)}:{}),
        ...(args.trustServerCertificate!==undefined
          ? {trustServerCertificate: Boolean(args.trustServerCertificate)}
          :{})
      };

      const result=await connectPool(overrides);
      const versionRows=connection.engine==="sqlserver"
        ? await runQuery("SELECT @@VERSION AS version")
        : await runQuery("SELECT VERSION() AS version").catch(() => [{version: "unknown"}]);

      return makeTextResult({
        ...result,
        version: versionRows?.[0]?.version??"unknown"
      });
    }

    case TOOL_NAMES.HEALTH_CHECK: {
      await ensureConnected();
      const started=Date.now();
      const ok=await runSelectOne();
      const latencyMs=Date.now()-started;
      return makeTextResult({
        ok,
        engine: connection?.engine,
        latencyMs
      });
    }

    case TOOL_NAMES.LIST_SCHEMAS: {
      await ensureConnected();
      const schemas=await runQuery(`
        SELECT schema_name
        FROM information_schema.schemata
        ORDER BY schema_name
      `);
      return makeTextResult({engine: connection.engine,schemas});
    }

    case TOOL_NAMES.LIST_TABLES: {
      await ensureConnected();

      let query=`
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
      `;
      const params={};

      if(args.schema) {
        params.schema=normalizeIdentifier(args.schema,"schema");
        query+=" WHERE table_schema = @schema";
      }

      query+=" ORDER BY table_schema, table_name";

      const tables=await runQuery(query,params);
      return makeTextResult({engine: connection.engine,tables});
    }

    case TOOL_NAMES.DESCRIBE_TABLE: {
      await ensureConnected();

      const schema=normalizeIdentifier(args.schema??"dbo","schema");
      const table=normalizeIdentifier(args.table,"table");

      const columns=await runQuery(`
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
      `,{schema,table});

      const primaryKeys=await runQuery(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = @schema
          AND tc.table_name = @table
        ORDER BY kcu.ordinal_position
      `,{schema,table});

      let indexes=[];
      if(connection.engine==="sqlserver") {
        indexes=await runQuery(`
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
        `,{schema,table});
      } else if(connection.engine==="postgres") {
        indexes=await runQuery(`
          SELECT indexname AS index_name, indexdef
          FROM pg_indexes
          WHERE schemaname = @schema
            AND tablename = @table
          ORDER BY indexname
        `,{schema,table});
      } else {
        indexes=await runQuery(`
          SELECT
            index_name,
            non_unique,
            column_name,
            seq_in_index
          FROM information_schema.statistics
          WHERE table_schema = @schema
            AND table_name = @table
          ORDER BY index_name, seq_in_index
        `,{schema,table});
      }

      return makeTextResult({
        engine: connection.engine,
        schema,
        table,
        columns,
        primaryKeys,
        indexes
      });
    }

    case TOOL_NAMES.QUERY: {
      // If database parameter is provided and differs from current, switch database
      if(args.database) {
        const currentDb=runtimeConfig?.database;
        if(currentDb!==args.database) {
          await connectPool({database: args.database});
        }
      } else {
        await ensureConnected();
      }

      const sqlText=validateQuerySafety(args.sql);
      if(getReadOnlyMode()) {
        validateQuerySafety(sqlText);
      }

      const maxRowsInput=args.maxRows!==undefined? Number(args.maxRows):getDefaultMaxRows();
      const maxRows=Number.isFinite(maxRowsInput)&&maxRowsInput>0? Math.min(maxRowsInput,2000):200;

      const started=Date.now();
      const rows=await runQuery(sqlText,args.params&&typeof args.params==="object"? args.params:{});
      const latencyMs=Date.now()-started;
      const limitedRows=rows.slice(0,maxRows);

      return makeTextResult({
        engine: connection.engine,
        database: runtimeConfig?.database,
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

const server=new Server(
  {
    name: "database-mcp",
    version: SERVER_VERSION
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema,async () => {
  return {
    tools: [
      {
        name: TOOL_NAMES.CONNECT,
        description: "Connect to a database (sqlserver, postgres, mysql) with optional alias/runtime overrides.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {
            target: {type: "string"},
            alias: {type: "string"},
            serverName: {type: "string"},
            engine: {type: "string",enum: ["sqlserver","postgres","mysql"]},
            connectionString: {type: "string"},
            host: {type: "string"},
            server: {type: "string"},
            port: {type: "number"},
            database: {type: "string"},
            user: {type: "string"},
            password: {type: "string"},
            integratedAuth: {type: "boolean"},
            encrypt: {type: "boolean"},
            ssl: {type: "boolean"},
            trustServerCertificate: {type: "boolean"},
            readOnly: {type: "boolean"},
            maxRows: {type: "number"}
          }
        }
      },
      {
        name: TOOL_NAMES.HEALTH_CHECK,
        description: "Check current database connection health.",
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
            schema: {type: "string"}
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
            schema: {type: "string"},
            table: {type: "string"}
          },
          required: ["table"]
        }
      },
      {
        name: TOOL_NAMES.QUERY,
        description: "Execute parameterized SELECT query. Optionally specify database to switch before query.",
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: "object",
          properties: {
            sql: {type: "string"},
            database: {type: "string"},
            params: {
              type: "object",
              additionalProperties: true
            },
            maxRows: {type: "number"}
          },
          required: ["sql"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema,async (request) => {
  try {
    return await handleToolCall(request.params.name,request.params.arguments??{});
  } catch(error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error? error.message:String(error)
        }
      ]
    };
  }
});

async function main() {
  const transport=new StdioServerTransport();
  await server.connect(transport);
}

main().catch(async (error) => {
  console.error("Fatal MCP server error:",error);
  await closePoolIfAny();
  process.exit(1);
});

process.on("SIGINT",async () => {
  await closePoolIfAny();
  process.exit(0);
});

process.on("SIGTERM",async () => {
  await closePoolIfAny();
  process.exit(0);
});
