const vscode=require("vscode");
const os=require("node:os");
const path=require("node:path");
const fs=require("node:fs");
const {exec}=require("node:child_process");

const PACKAGE_NAME="@kingsnow129/sqlserver-mcp";
const PACKAGE_VERSION=require("../package.json").version;

function getUserPaths() {
  const home=os.homedir();
  const appData=process.env.APPDATA||path.join(home,"AppData","Roaming");
  const installRoot=path.join(home,".mcp-servers","sqlserver-mcp");
  const envPath=path.join(installRoot,".env");
  const mcpJsonPath=path.join(appData,"Code","User","mcp.json");

  return {installRoot,envPath,mcpJsonPath};
}

function runCommand(command,args,cwd) {
  return new Promise((resolve,reject) => {
    const quotedArgs=args.map((arg) => `"${arg}"`).join(" ");
    const cmdLine=`${command} ${quotedArgs}`;
    exec(cmdLine,{cwd,shell: true},(error,stdout,stderr) => {
      if(error) {
        reject(new Error(`${cmdLine} failed: ${stderr||error.message}`));
        return;
      }
      resolve({stdout,stderr});
    });
  });
}

function getMcpServerConfig() {
  return {
    type: "stdio",
    command: "node",
    args: [
      "${userHome}/.mcp-servers/sqlserver-mcp/node_modules/@kingsnow129/sqlserver-mcp/dist/server.js"
    ],
    envFile: "${userHome}/.mcp-servers/sqlserver-mcp/.env"
  };
}

function ensureEnvFile(envPath) {
  if(!fs.existsSync(envPath)) {
    const template=[
      "DB_SERVER=localhost",
      "DB_PORT=1433",
      "DB_NAME=master",
      "DB_USER=sa",
      "DB_PASSWORD=",
      "DB_ENCRYPT=true",
      "DB_TRUST_SERVER_CERT=true",
      "DB_CONN_TIMEOUT_MS=15000",
      "DB_REQUEST_TIMEOUT_MS=15000",
      "DB_POOL_MAX=10",
      "DB_POOL_MIN=0",
      "DB_POOL_IDLE_TIMEOUT_MS=30000",
      "DB_READ_ONLY=true",
      "DB_MAX_ROWS=200",
      ""
    ].join("\n");

    fs.writeFileSync(envPath,template,"utf8");
  }
}

function readJsonIfExists(filePath) {
  if(!fs.existsSync(filePath)) {
    return {};
  }

  const raw=fs.readFileSync(filePath,"utf8").trim();
  if(!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function writeJson(filePath,obj) {
  fs.mkdirSync(path.dirname(filePath),{recursive: true});
  fs.writeFileSync(filePath,`${JSON.stringify(obj,null,2)}\n`,"utf8");
}

async function installOrUpdateUser() {
  const {installRoot,envPath,mcpJsonPath}=getUserPaths();
  const npmCmd=process.platform==="win32"? "npm.cmd":"npm";

  fs.mkdirSync(installRoot,{recursive: true});

  const packageJsonPath=path.join(installRoot,"package.json");
  if(!fs.existsSync(packageJsonPath)) {
    await runCommand(npmCmd,["init","-y"],installRoot);
  }

  await runCommand(npmCmd,["install","--save-exact",`${PACKAGE_NAME}@${PACKAGE_VERSION}`],installRoot);

  ensureEnvFile(envPath);

  const mcpConfig=readJsonIfExists(mcpJsonPath);
  if(!mcpConfig.servers||typeof mcpConfig.servers!=="object") {
    mcpConfig.servers={};
  }
  mcpConfig.servers.sqlserverMcp=getMcpServerConfig();
  writeJson(mcpJsonPath,mcpConfig);

  const openEnv="Open Env";
  const openServers="Open MCP List Servers";
  const choice=await vscode.window.showInformationMessage(
    "SQLServer MCP installed for user profile. User mcp.json updated.",
    openEnv,
    openServers
  );

  if(choice===openEnv) {
    await openEnvFile();
  }
  if(choice===openServers) {
    await openMcpListServers();
  }
}

async function openEnvFile() {
  const {envPath}=getUserPaths();
  fs.mkdirSync(path.dirname(envPath),{recursive: true});
  ensureEnvFile(envPath);

  const doc=await vscode.workspace.openTextDocument(envPath);
  await vscode.window.showTextDocument(doc,{preview: false});
}

async function openMcpListServers() {
  await vscode.commands.executeCommand("workbench.action.quickOpen",">MCP: List Servers");
}

async function openUserMcpConfig() {
  await vscode.commands.executeCommand("workbench.action.quickOpen",">MCP: Open User Configuration");
}

function activate(context) {
  const subscriptions=[
    vscode.commands.registerCommand("sqlserverMcp.installUser",async () => {
      try {
        await installOrUpdateUser();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`SQLServer MCP install failed: ${message}`);
      }
    }),
    vscode.commands.registerCommand("sqlserverMcp.openEnv",async () => {
      try {
        await openEnvFile();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`Failed to open env: ${message}`);
      }
    }),
    vscode.commands.registerCommand("sqlserverMcp.openMcpListServers",async () => {
      try {
        await openMcpListServers();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`Failed to open MCP server list: ${message}`);
      }
    }),
    vscode.commands.registerCommand("sqlserverMcp.openUserMcpConfig",async () => {
      try {
        await openUserMcpConfig();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`Failed to open user MCP config: ${message}`);
      }
    })
  ];

  context.subscriptions.push(...subscriptions);
}

function deactivate() {
  return undefined;
}

module.exports={
  activate,
  deactivate
};
