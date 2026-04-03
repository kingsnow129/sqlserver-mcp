const vscode=require("vscode");
const os=require("node:os");
const path=require("node:path");
const fs=require("node:fs");
const {exec}=require("node:child_process");

const PACKAGE_NAME="@kingsnow129/database-mcp";
const PACKAGE_VERSION=require("./package.json").version;

function getUserPaths() {
  const home=os.homedir();
  const appData=process.env.APPDATA||path.join(home,"AppData","Roaming");
  const installRoot=path.join(home,".mcp-servers","database-mcp");
  const envPath=path.join(installRoot,".env");
  const profilesPath=path.join(installRoot,"profiles.json");
  const mcpJsonPath=path.join(appData,"Code","User","mcp.json");

  return {installRoot,envPath,profilesPath,mcpJsonPath};
}

function removeDirectoryIfExists(dirPath) {
  if(fs.existsSync(dirPath)) {
    fs.rmSync(dirPath,{recursive: true,force: true});
  }
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
      "${userHome}/.mcp-servers/database-mcp/node_modules/@kingsnow129/database-mcp/dist/server.js",
      "--profilesFile",
      "${userHome}/.mcp-servers/database-mcp/profiles.json"
    ]
  };
}

function ensureEnvFile(envPath) {
  if(!fs.existsSync(envPath)) {
    const template=[
      "DB_ENGINE=sqlserver",
      "DB_CONNECTION_STRING=",
      "DB_HOST=localhost",
      "DB_SERVER=localhost",
      "DB_PORT=1433",
      "DB_NAME=master",
      "DB_USER=sa",
      "DB_PASSWORD=",
      "DB_SSL=false",
      "DB_ENCRYPT=true",
      "DB_TRUST_SERVER_CERT=true",
      "DB_CONN_TIMEOUT_MS=15000",
      "DB_REQUEST_TIMEOUT_MS=15000",
      "DB_POOL_MAX=10",
      "DB_POOL_MIN=0",
      "DB_POOL_IDLE_TIMEOUT_MS=30000",
      "DB_READ_ONLY=true",
      "DB_MAX_ROWS=200",
      "DB_DEFAULT_ALIAS=local-sqlserver",
      ""
    ].join("\n");

    fs.writeFileSync(envPath,template,"utf8");
  }
}

function ensureProfilesFile(profilesPath) {
  if(!fs.existsSync(profilesPath)) {
    const initial={
      defaultServer: "local-server",
      servers: {
        "local-server": {
          engine: "sqlserver",
          host: "localhost",
          port: 1433,
          user: "sa",
          password: "",
          encrypt: true,
          trustServerCertificate: true,
          databases: [
            {name: "master",readOnly: true,maxRows: 200}
          ]
        }
      }
    };
    fs.writeFileSync(profilesPath,`${JSON.stringify(initial,null,2)}\n`,"utf8");
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

function getProfilesState() {
  const {profilesPath}=getUserPaths();
  ensureProfilesFile(profilesPath);
  const raw=readJsonIfExists(profilesPath);
  if(!raw.servers||typeof raw.servers!=="object") {
    raw.servers={};
  }
  return {profilesPath,state: raw};
}

function syncDefaultAliasToEnv(defaultAlias) {
  const {envPath}=getUserPaths();
  ensureEnvFile(envPath);
  const envRaw=fs.readFileSync(envPath,"utf8");
  if(/\n?DB_DEFAULT_ALIAS=.*/.test(envRaw)) {
    fs.writeFileSync(envPath,envRaw.replace(/DB_DEFAULT_ALIAS=.*/g,`DB_DEFAULT_ALIAS=${defaultAlias}`),"utf8");
  } else {
    fs.appendFileSync(envPath,`\nDB_DEFAULT_ALIAS=${defaultAlias}\n`,"utf8");
  }
}

function normalizeAliasPayload(input) {
  const alias=String(input?.alias??"").trim();
  const aliasError=validateAlias(alias);
  if(aliasError) {
    throw new Error(aliasError);
  }

  const engine=String(input?.config?.engine??"").trim().toLowerCase();
  if(!["sqlserver","postgres","mysql"].includes(engine)) {
    throw new Error("Engine must be sqlserver, postgres, or mysql.");
  }

  const config={
    engine,
    readOnly: Boolean(input?.config?.readOnly),
    maxRows: Number.parseInt(String(input?.config?.maxRows??"200"),10)
  };

  if(!Number.isFinite(config.maxRows)||config.maxRows<=0) {
    throw new Error("maxRows must be a positive number.");
  }

  if(input?.config?.connectionString) {
    config.connectionString=String(input.config.connectionString).trim();
    if(!config.connectionString) {
      throw new Error("Connection string cannot be empty.");
    }
  } else {
    config.host=String(input?.config?.host??"").trim();
    config.port=Number.parseInt(String(input?.config?.port??""),10);
    config.database=String(input?.config?.database??"").trim();
    config.user=String(input?.config?.user??"").trim();
    config.password=String(input?.config?.password??"");

    if(!config.host||!config.database||!config.user) {
      throw new Error("Host, database, and user are required.");
    }
    if(!Number.isFinite(config.port)||config.port<=0) {
      throw new Error("Port must be a positive number.");
    }

    if(engine==="sqlserver") {
      config.encrypt=Boolean(input?.config?.encrypt);
      config.trustServerCertificate=Boolean(input?.config?.trustServerCertificate);
    } else {
      config.ssl=Boolean(input?.config?.ssl);
      config.trustServerCertificate=Boolean(input?.config?.trustServerCertificate);
    }
  }

  return {alias,config};
}

function buildAliasManagerHtml(webview) {
  const nonce=Math.random().toString(36).substr(2,9);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Database Server Manager</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); margin: 0; }
    h2 { margin: 0 0 12px; }
    .container { display: grid; grid-template-columns: 250px 1fr; gap: 12px; height: calc(100vh - 60px); }
    .left, .right { overflow: auto; border: 1px solid var(--vscode-panel-border); padding: 8px; }
    .server-list h3 { margin: 0 0 8px; font-size: 12px; }
    .server-item { padding: 6px; margin-bottom: 4px; border-left: 3px solid transparent; cursor: pointer; background: var(--vscode-editor-inactiveSelectionBackground); }
    .server-item.selected { border-left-color: var(--vscode-focusBorder); background: var(--vscode-editor-selectionBackground); }
    .server-item:hover { background: var(--vscode-editor-hoverHighlightBackground); }
    .server-actions { display: flex; gap: 4px; margin-top: 4px; }
    button { padding: 4px 8px; font-size: 11px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    label { font-size: 12px; display: block; margin-bottom: 4px; font-weight: 600; }
    input, select { width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    .actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
    .section-title { margin-top: 16px; margin-bottom: 8px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 6px; text-align: left; font-size: 12px; }
    .tag { font-size: 11px; padding: 2px 6px; border: 1px solid var(--vscode-panel-border); display: inline-block; }
    .msg { margin: 8px 0; min-height: 20px; color: var(--vscode-editorInfo-foreground); font-size: 12px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h2>Database MCP: Database Server Manager</h2>
  <div class="container">
    <div class="left">
      <div class="server-list">
        <h3>Servers</h3>
        <button id="addServerBtn" style="width:100%;margin-bottom:8px;">+ New Server</button>
        <div id="serverList"></div>
      </div>
    </div>
    <div class="right">
      <div id="noSelection" class="msg">Select a server to edit</div>
      <div id="serverPanel" class="hidden">
        <h3 id="panelTitle" style="margin:0 0 12px;"></h3>
        <div class="row">
          <div><label>Server Name</label><input id="serverName" /></div>
          <div><label>Engine</label><select id="engine"><option value="sqlserver">sqlserver</option><option value="postgres">postgres</option><option value="mysql">mysql</option></select></div>
        </div>
        <div class="row">
          <div><label>Host</label><input id="host" value="localhost" /></div>
          <div><label>Port</label><input id="port" value="1433" /></div>
        </div>
        <div class="row" id="integratedRow">
          <div><label><input type="checkbox" id="integratedAuth" /> Integrated Auth</label></div>
          <div></div>
        </div>
        <div class="row" id="credentialsRow">
          <div><label>User</label><input id="user" /></div>
          <div><label>Password</label><input id="password" type="password" /></div>
        </div>
        <div class="row" id="encryptRow">
          <div><label>Encrypt (sqlserver)</label><select id="encrypt"><option value="true">true</option><option value="false">false</option></select></div>
          <div><label>Trust Server Cert</label><select id="trustServerCertificate"><option value="true">true</option><option value="false">false</option></select></div>
        </div>
        <div class="row" id="sslRow" style="display:none;">
          <div><label>SSL</label><select id="ssl"><option value="false">false</option><option value="true">true</option></select></div>
          <div><label>Trust Server Cert</label><select id="trustServerCert2"><option value="true">true</option><option value="false">false</option></select></div>
        </div>
        <div class="actions">
          <button id="saveServer">Save Server</button>
          <button id="deleteServer" class="secondary">Delete Server</button>
        </div>
        <div class="section-title">Databases</div>
        <div class="row">
          <div><label>New Database Name</label><input id="newDbName" /></div>
          <div style="display:flex;align-items:flex-end;"><button id="addDatabaseBtn" style="width:100%;">+ Add Database</button></div>
        </div>
        <table id="dbTable" style="display:none;">
          <thead><tr><th>Name</th><th>Max Rows</th><th>Read Only</th><th>Actions</th></tr></thead>
          <tbody id="dbRows"></tbody>
        </table>
        <div id="noDb" class="msg">No databases</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = { defaultServer: undefined, servers: {} };
    let selectedServer = null;
    let selectedDb = null;

    function byId(id) { return document.getElementById(id); }
    function bool(v) { return String(v) === 'true'; }

    function renderServerList() {
      const list = byId('serverList');
      list.innerHTML = '';
      const servers = Object.keys(state.servers || {}).sort();
      for (const srv of servers) {
        const div = document.createElement('div');
        div.className = 'server-item' + (selectedServer === srv ? ' selected' : '');
        div.innerHTML = '<strong>' + srv + '</strong><br><span class="tag">' + (state.servers[srv].engine || '?') + '</span>' + (state.defaultServer === srv ? ' <span class="tag">default</span>' : '');
        div.onclick = () => selectServer(srv);
        list.appendChild(div);
      }
    }

    function selectServer(srv) {
      selectedServer = srv;
      selectedDb = null;
      renderServerList();
      showServerPanel();
    }

    function showServerPanel() {
      byId('noSelection').style.display = 'none';
      const panel = byId('serverPanel');
      panel.classList.remove('hidden');
      if (!selectedServer) {
        byId('noSelection').style.display = 'block';
        panel.classList.add('hidden');
        return;
      }
      const srv = state.servers[selectedServer] || {};
      byId('panelTitle').textContent = 'Server: ' + selectedServer;
      byId('serverName').value = selectedServer;
      byId('engine').value = srv.engine || 'sqlserver';
      byId('host').value = srv.host || 'localhost';
      byId('port').value = String(srv.port || 1433);
      byId('integratedAuth').checked = Boolean(srv.integratedAuth);
      byId('user').value = srv.user || '';
      byId('password').value = srv.password || '';
      byId('encrypt').value = String(srv.encrypt !== false);
      byId('ssl').value = String(srv.ssl === true);
      byId('trustServerCertificate').value = String(srv.trustServerCertificate !== false);
      byId('trustServerCert2').value = String(srv.trustServerCertificate !== false);
      
      const isSQL = byId('engine').value === 'sqlserver';
      byId('encryptRow').style.display = isSQL ? '' : 'none';
      byId('sslRow').style.display = !isSQL ? '' : 'none';
      
      updateCredentialsVisibility();
      renderDatabases();
    }

    function updateCredentialsVisibility() {
      const isIntegrated = byId('integratedAuth').checked;
      byId('credentialsRow').style.display = isIntegrated ? 'none' : '';
    }

    byId('integratedAuth').addEventListener('change', updateCredentialsVisibility);

    function renderDatabases() {
      if (!selectedServer) return;
      const srv = state.servers[selectedServer] || {};
      const dbs = srv.databases || [];
      const tbody = byId('dbRows');
      tbody.innerHTML = '';
      for (const db of dbs) {
        const tr = document.createElement('tr');
        const isActive = state.currentServer === selectedServer && state.currentDatabase === db.name;
        tr.innerHTML = '<td>' + (isActive ? '★ ' : '') + db.name + '</td><td>' + (db.maxRows || 200) + '</td><td>' + (db.readOnly ? 'yes' : 'no') + '</td><td><button data-act="setActive" data-db="' + db.name + '" class="secondary">Set Active</button> <button data-act="editDb" data-db="' + db.name + '">Edit</button> <button data-act="delDb" data-db="' + db.name + '" class="secondary">Delete</button></td>';
        tbody.appendChild(tr);
      }
      byId('dbTable').style.display = dbs.length > 0 ? '' : 'none';
      byId('noDb').style.display = dbs.length === 0 ? '' : 'none';
    }

    byId('engine').addEventListener('change', () => {
      const isSQL = byId('engine').value === 'sqlserver';
      byId('encryptRow').style.display = isSQL ? '' : 'none';
      byId('sslRow').style.display = !isSQL ? '' : 'none';
    });

    byId('saveServer').addEventListener('click', () => {
      const name = byId('serverName').value.trim();
      if (!name) { alert('Server name required'); return; }
      if (name !== selectedServer && state.servers[name]) { alert('Server already exists'); return; }
      
      const oldName = selectedServer;
      const isIntegrated = byId('integratedAuth').checked;
      const payload = {
        serverName: name,
        oldName: oldName,
        config: {
          engine: byId('engine').value,
          host: byId('host').value,
          port: Number(byId('port').value),
          integratedAuth: isIntegrated,
          user: isIntegrated ? '' : byId('user').value,
          password: isIntegrated ? '' : byId('password').value,
          encrypt: bool(byId('encrypt').value),
          ssl: bool(byId('ssl').value),
          trustServerCertificate: bool(byId('trustServerCertificate').value),
          databases: state.servers[oldName]?.databases || []
        }
      };
      vscode.postMessage({ type: 'saveServer', payload });
    });

    byId('deleteServer').addEventListener('click', () => {
      if (!selectedServer) return;
      vscode.postMessage({ type: 'deleteServer', serverName: selectedServer });
    });

    function addNewServer() {
      selectedServer = null;
      selectedDb = null;
      byId('noSelection').style.display = 'none';
      byId('serverPanel').classList.remove('hidden');
      byId('panelTitle').textContent = 'Server: <new>';
      byId('serverName').value = '';
      byId('engine').value = 'sqlserver';
      byId('host').value = 'localhost';
      byId('port').value = '1433';
      byId('integratedAuth').checked = false;
      byId('user').value = '';
      byId('password').value = '';
      byId('encrypt').value = 'true';
      byId('ssl').value = 'false';
      byId('trustServerCertificate').value = 'true';
      byId('trustServerCert2').value = 'true';
      byId('dbRows').innerHTML = '';
      byId('dbTable').style.display = 'none';
      byId('noDb').style.display = '';
      updateCredentialsVisibility();
    }

    function addDatabase() {
      if (!selectedServer) { return; }
      const name = (byId('newDbName').value || '').trim();
      if (!name) { return; }
      vscode.postMessage({ type: 'addDatabase', serverName: selectedServer, dbName: name });
      byId('newDbName').value = '';
    }

    byId('dbRows').addEventListener('click', (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const act = target.getAttribute('data-act');
      const dbName = target.getAttribute('data-db');
      if (!act || !dbName) return;
      if (act === 'setActive') {
        vscode.postMessage({ type: 'setActiveDatabase', serverName: selectedServer, dbName: dbName });
      } else if (act === 'editDb') {
        selectedDb = dbName;
        showEditDatabaseDialog();
      } else if (act === 'delDb') {
        vscode.postMessage({ type: 'deleteDatabase', serverName: selectedServer, dbName: dbName });
      }
    });

    function showEditDatabaseDialog() {
      if (!selectedServer || !selectedDb) return;
      const srv = state.servers[selectedServer] || {};
      const db = srv.databases?.find(d => d.name === selectedDb) || {};
      const nextReadOnly = !Boolean(db.readOnly);
      vscode.postMessage({
        type: 'updateDatabase',
        serverName: selectedServer,
        dbName: selectedDb,
        config: { name: selectedDb, maxRows: Number(db.maxRows) || 200, readOnly: nextReadOnly }
      });
    }

    byId('addServerBtn').addEventListener('click', addNewServer);
    byId('addDatabaseBtn').addEventListener('click', addDatabase);

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'state') {
        state = msg.payload || { defaultServer: undefined, servers: {} };
        selectedServer = null;
        selectedDb = null;
        renderServerList();
        showServerPanel();
      }
    });

    vscode.postMessage({ type: 'requestState' });
  </script>
</body>
</html>`;}


async function openAliasManagerPanel() {
  const panel=vscode.window.createWebviewPanel(
    "databaseMcpServerManager",
    "Database MCP: Server Manager",
    vscode.ViewColumn.One,
    {enableScripts: true}
  );

  const postState=() => {
    const {state}=getProfilesState();
    panel.webview.postMessage({type: "state",payload: state});
  };

  panel.webview.html=buildAliasManagerHtml(panel.webview);

  panel.webview.onDidReceiveMessage((message) => {
    try {
      if(message?.type==="requestState") {
        postState();
        return;
      }

      if(message?.type==="saveServer") {
        const {profilesPath,state}=getProfilesState();
        const payload=message.payload||{};
        const serverName=String(payload.serverName??"").trim();
        const oldName=String(payload.oldName??"").trim();
        const config=payload.config||{};

        if(!serverName) {
          throw new Error("Server name is required.");
        }
        if(!/^[A-Za-z0-9 _-]+$/.test(serverName)) {
          throw new Error("Use letters, numbers, spaces, underscore or hyphen in server name.");
        }

        if(oldName&&oldName!==serverName&&state.servers[serverName]) {
          throw new Error(`Server '${serverName}' already exists.`);
        }

        if(oldName&&oldName!==serverName) {
          delete state.servers[oldName];
          if(state.defaultServer===oldName) {
            state.defaultServer=serverName;
          }
        }

        state.servers[serverName]=config;
        if(!state.defaultServer) {
          state.defaultServer=serverName;
        }
        writeJson(profilesPath,state);
        panel.webview.postMessage({type: "toast",payload: `Saved server '${serverName}'.`});
        postState();
        return;
      }

      if(message?.type==="deleteServer") {
        const serverName=String(message.serverName??"").trim();
        const {profilesPath,state}=getProfilesState();
        if(state.servers[serverName]) {
          delete state.servers[serverName];
          if(state.defaultServer===serverName) {
            state.defaultServer=Object.keys(state.servers)[0];
          }
          writeJson(profilesPath,state);
        }
        panel.webview.postMessage({type: "toast",payload: `Deleted server '${serverName}'.`});
        postState();
        return;
      }

      if(message?.type==="addDatabase") {
        const serverName=String(message.serverName??"").trim();
        const dbName=String(message.dbName??"").trim();
        const {profilesPath,state}=getProfilesState();
        if(!state.servers[serverName]) {
          throw new Error(`Server '${serverName}' not found.`);
        }
        if(!dbName) {
          throw new Error("Database name is required.");
        }
        if(!state.servers[serverName].databases) {
          state.servers[serverName].databases=[];
        }
        if(state.servers[serverName].databases.some((d)=>d.name===dbName)) {
          throw new Error(`Database '${dbName}' already exists.`);
        }
        state.servers[serverName].databases.push({name: dbName,readOnly: true,maxRows: 200});
        writeJson(profilesPath,state);
        panel.webview.postMessage({type: "toast",payload: `Added database '${dbName}'.`});
        postState();
        return;
      }

      if(message?.type==="updateDatabase") {
        const serverName=String(message.serverName??"").trim();
        const dbName=String(message.dbName??"").trim();
        const config=message.config||{};
        const {profilesPath,state}=getProfilesState();
        if(!state.servers[serverName]) {
          throw new Error(`Server '${serverName}' not found.`);
        }
        const dbs=state.servers[serverName].databases||[];
        const idx=dbs.findIndex((d)=>d.name===dbName);
        if(idx===-1) {
          throw new Error(`Database '${dbName}' not found.`);
        }
        dbs[idx]=config;
        writeJson(profilesPath,state);
        panel.webview.postMessage({type: "toast",payload: `Updated database '${dbName}'.`});
        postState();
        return;
      }

      if(message?.type==="deleteDatabase") {
        const serverName=String(message.serverName??"").trim();
        const dbName=String(message.dbName??"").trim();
        const {profilesPath,state}=getProfilesState();
        if(!state.servers[serverName]) {
          throw new Error(`Server '${serverName}' not found.`);
        }
        const dbs=state.servers[serverName].databases||[];
        const idx=dbs.findIndex((d)=>d.name===dbName);
        if(idx!==-1) {
          dbs.splice(idx,1);
        }
        writeJson(profilesPath,state);
        panel.webview.postMessage({type: "toast",payload: `Deleted database '${dbName}'.`});
        postState();
        return;
      }

      if(message?.type==="setActiveDatabase") {
        const serverName=String(message.serverName??"").trim();
        const dbName=String(message.dbName??"").trim();
        const {profilesPath,state}=getProfilesState();
        if(!state.servers[serverName]) {
          throw new Error(`Server '${serverName}' not found.`);
        }
        const dbs=state.servers[serverName].databases||[];
        if(!dbs.find((d)=>d.name===dbName)) {
          throw new Error(`Database '${dbName}' not found.`);
        }
        state.currentServer=serverName;
        state.currentDatabase=dbName;
        writeJson(profilesPath,state);
        panel.webview.postMessage({type: "toast",payload: `Active database set to '${serverName}/${dbName}'.`});
        postState();
        return;
      }
    } catch(error) {
      const messageText=error instanceof Error? error.message:String(error);
      panel.webview.postMessage({type: "toast",payload: `Error: ${messageText}`});
      vscode.window.showErrorMessage(`Server manager failed: ${messageText}`);
    }
  });

  postState();
}

function validateAlias(value) {
  if(!value||typeof value!=="string") {
    return "Alias is required.";
  }
  if(!/^[A-Za-z0-9_-]+$/.test(value.trim())) {
    return "Use letters, numbers, underscore or hyphen.";
  }
  return undefined;
}

async function promptRequired(options) {
  while(true) {
    const value=await vscode.window.showInputBox(options);
    if(value===undefined) {
      return undefined;
    }
    if(String(value).trim().length>0) {
      return String(value).trim();
    }
  }
}

async function promptBoolean(title,currentValue) {
  const pick=await vscode.window.showQuickPick(
    [
      {label: "true",value: true},
      {label: "false",value: false}
    ],
    {
      title,
      placeHolder: currentValue===undefined? "Select":`Current: ${String(currentValue)}`
    }
  );

  return pick? pick.value:undefined;
}

async function collectAliasConfig(existingAlias,existingConfig={}) {
  const aliasInput=await vscode.window.showInputBox({
    title: "Database Alias",
    value: existingAlias||"",
    validateInput: validateAlias
  });
  if(aliasInput===undefined) return undefined;
  const alias=aliasInput.trim();

  const enginePick=await vscode.window.showQuickPick(
    [
      {label: "SQL Server",value: "sqlserver"},
      {label: "PostgreSQL",value: "postgres"},
      {label: "MySQL",value: "mysql"}
    ],
    {
      title: "Database Engine",
      placeHolder: existingConfig.engine? `Current: ${existingConfig.engine}`:"Select database engine"
    }
  );
  if(!enginePick) return undefined;
  const engine=enginePick.value;

  const modePick=await vscode.window.showQuickPick(
    [
      {label: "Connection String",value: "connectionString"},
      {label: "Host / Port / User / Password",value: "fields"}
    ],
    {
      title: "Connection Mode",
      placeHolder: "Choose how to configure this alias"
    }
  );
  if(!modePick) return undefined;

  const config={engine};

  if(modePick.value==="connectionString") {
    const connectionString=await promptRequired({
      title: "Connection String",
      value: existingConfig.connectionString||"",
      password: true
    });
    if(connectionString===undefined) return undefined;
    config.connectionString=connectionString;
  } else {
    const host=await promptRequired({
      title: "Host",
      value: existingConfig.host||existingConfig.server||"localhost"
    });
    if(host===undefined) return undefined;

    const defaultPort=engine==="sqlserver"? "1433":(engine==="postgres"? "5432":"3306");
    const port=await promptRequired({
      title: "Port",
      value: String(existingConfig.port??defaultPort),
      validateInput: (value) => /^\d+$/.test(String(value).trim())? undefined:"Port must be a number"
    });
    if(port===undefined) return undefined;

    const database=await promptRequired({
      title: "Database",
      value: existingConfig.database||""
    });
    if(database===undefined) return undefined;

    const user=await promptRequired({
      title: "User",
      value: existingConfig.user||""
    });
    if(user===undefined) return undefined;

    const password=await vscode.window.showInputBox({
      title: "Password",
      value: existingConfig.password||"",
      password: true
    });
    if(password===undefined) return undefined;

    config.host=host;
    config.port=Number.parseInt(port,10);
    config.database=database;
    config.user=user;
    config.password=password;

    if(engine==="sqlserver") {
      const encrypt=await promptBoolean("Encrypt",existingConfig.encrypt??true);
      if(encrypt===undefined) return undefined;
      const trust=await promptBoolean("Trust Server Certificate",existingConfig.trustServerCertificate??true);
      if(trust===undefined) return undefined;
      config.encrypt=encrypt;
      config.trustServerCertificate=trust;
    } else {
      const ssl=await promptBoolean("Use SSL",existingConfig.ssl??false);
      if(ssl===undefined) return undefined;
      const trust=await promptBoolean("Trust Server Certificate",existingConfig.trustServerCertificate??false);
      if(trust===undefined) return undefined;
      config.ssl=ssl;
      config.trustServerCertificate=trust;
    }
  }

  const readOnly=await promptBoolean("Read-only mode",existingConfig.readOnly??true);
  if(readOnly===undefined) return undefined;
  config.readOnly=readOnly;

  const maxRows=await promptRequired({
    title: "Max Rows",
    value: String(existingConfig.maxRows??200),
    validateInput: (value) => /^\d+$/.test(String(value).trim())? undefined:"Max rows must be a number"
  });
  if(maxRows===undefined) return undefined;
  config.maxRows=Number.parseInt(maxRows,10);

  return {alias,config};
}

async function addOrEditAlias(existingAlias) {
  const {profilesPath,state}=getProfilesState();
  const existingConfig=existingAlias? state.aliases[existingAlias]:{};
  const collected=await collectAliasConfig(existingAlias,existingConfig);
  if(!collected) {
    return;
  }

  if(existingAlias&&existingAlias!==collected.alias) {
    delete state.aliases[existingAlias];
    if(state.defaultAlias===existingAlias) {
      state.defaultAlias=collected.alias;
    }
  }

  state.aliases[collected.alias]=collected.config;
  if(!state.defaultAlias) {
    state.defaultAlias=collected.alias;
  }
  writeJson(profilesPath,state);

  vscode.window.showInformationMessage(`Saved alias '${collected.alias}'.`);
}

async function deleteAlias() {
  const {profilesPath,state}=getProfilesState();
  const aliases=Object.keys(state.aliases);
  if(aliases.length===0) {
    vscode.window.showInformationMessage("No aliases to delete.");
    return;
  }

  const pick=await vscode.window.showQuickPick(aliases.map((alias) => ({
    label: alias,
    description: state.aliases[alias].engine||"unknown"
  })),{title: "Delete Alias"});

  if(!pick) {
    return;
  }

  delete state.aliases[pick.label];
  if(state.defaultAlias===pick.label) {
    state.defaultAlias=Object.keys(state.aliases)[0];
  }

  writeJson(profilesPath,state);
  vscode.window.showInformationMessage(`Deleted alias '${pick.label}'.`);
}

async function setDefaultAlias() {
  const {profilesPath,state}=getProfilesState();
  const aliases=Object.keys(state.aliases);
  if(aliases.length===0) {
    vscode.window.showInformationMessage("No aliases available.");
    return;
  }

  const pick=await vscode.window.showQuickPick(
    aliases.map((alias) => ({
      label: alias,
      description: alias===state.defaultAlias? "current default":state.aliases[alias].engine
    })),
    {title: "Set Default Alias"}
  );

  if(!pick) {
    return;
  }

  state.defaultAlias=pick.label;
  writeJson(profilesPath,state);

  const {envPath}=getUserPaths();
  ensureEnvFile(envPath);
  const envRaw=fs.readFileSync(envPath,"utf8");
  if(/\n?DB_DEFAULT_ALIAS=.*/.test(envRaw)) {
    fs.writeFileSync(envPath,envRaw.replace(/DB_DEFAULT_ALIAS=.*/g,`DB_DEFAULT_ALIAS=${pick.label}`),"utf8");
  } else {
    fs.appendFileSync(envPath,`\nDB_DEFAULT_ALIAS=${pick.label}\n`,"utf8");
  }

  vscode.window.showInformationMessage(`Default alias set to '${pick.label}'.`);
}

function isInstalled() {
  const {installRoot}=getUserPaths();
  const packageJsonPath=path.join(installRoot,"package.json");
  return fs.existsSync(packageJsonPath);
}

async function openProfilesFile() {
  const {profilesPath}=getUserPaths();
  ensureProfilesFile(profilesPath);

  const doc=await vscode.workspace.openTextDocument(profilesPath);
  await vscode.window.showTextDocument(doc,{preview: false});
}

async function manageAliases() {
  if(!isInstalled()) {
    vscode.window.showInformationMessage("Installing Database MCP...");
    await installOrUpdateUser();
  }
  await openAliasManagerPanel();
}

async function installOrUpdateUser() {
  const {installRoot,envPath,profilesPath,mcpJsonPath}=getUserPaths();
  const npmCmd=process.platform==="win32"? "npm.cmd":"npm";

  fs.mkdirSync(installRoot,{recursive: true});

  const packageJsonPath=path.join(installRoot,"package.json");
  if(!fs.existsSync(packageJsonPath)) {
    await runCommand(npmCmd,["init","-y"],installRoot);
  }

  await runCommand(npmCmd,["install","--save-exact",`${PACKAGE_NAME}@${PACKAGE_VERSION}`],installRoot);

  ensureEnvFile(envPath);
  ensureProfilesFile(profilesPath);

  const mcpConfig=readJsonIfExists(mcpJsonPath);
  if(!mcpConfig.servers||typeof mcpConfig.servers!=="object") {
    mcpConfig.servers={};
  }
  mcpConfig.servers.databaseMcp=getMcpServerConfig();
  writeJson(mcpJsonPath,mcpConfig);

  vscode.window.showInformationMessage("Database MCP installed successfully. Ready to use.");
}

async function uninstallUser() {
  const {installRoot,mcpJsonPath}=getUserPaths();

  const choice=await vscode.window.showWarningMessage(
    "This will remove Database MCP runtime files and MCP config entries for this user.",
    {modal: true},
    "Uninstall"
  );

  if(choice!=="Uninstall") {
    return;
  }

  const mcpConfig=readJsonIfExists(mcpJsonPath);
  if(mcpConfig.servers&&typeof mcpConfig.servers==="object") {
    delete mcpConfig.servers.databaseMcp;
    writeJson(mcpJsonPath,mcpConfig);
  }

  removeDirectoryIfExists(installRoot);

  vscode.window.showInformationMessage("Database MCP user runtime/config removed. You can now uninstall the extension.");
}

async function openMcpListServers() {
  if(!isInstalled()) {
    vscode.window.showInformationMessage("Installing Database MCP...");
    await installOrUpdateUser();
  }
  await vscode.commands.executeCommand("workbench.action.quickOpen",">MCP: List Servers");
}

function activate(context) {
  const subscriptions=[
    vscode.commands.registerCommand("databaseMcp.uninstallUser",async () => {
      try {
        await uninstallUser();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`Failed to uninstall Database MCP: ${message}`);
      }
    }),
    vscode.commands.registerCommand("databaseMcp.manageAliases",async () => {
      try {
        await manageAliases();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`Failed to manage aliases: ${message}`);
      }
    }),
    vscode.commands.registerCommand("databaseMcp.openMcpListServers",async () => {
      try {
        await openMcpListServers();
      } catch(error) {
        const message=error instanceof Error? error.message:String(error);
        vscode.window.showErrorMessage(`Failed to open MCP server list: ${message}`);
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
