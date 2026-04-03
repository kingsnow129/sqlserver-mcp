import {chmod,copyFile,mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const rootDir=path.resolve(__dirname,"..");
const sourceFile=path.join(rootDir,"src","server.js");
const distDir=path.join(rootDir,"dist");
const targetFile=path.join(distDir,"server.js");

// Read version from package.json (single source of truth)
const pkg=JSON.parse(await readFile(path.join(rootDir,"package.json"),"utf8"));
const version=pkg.version;

// Sync version into server.json
const serverJsonPath=path.join(rootDir,"server.json");
const serverJson=JSON.parse(await readFile(serverJsonPath,"utf8"));
serverJson.version=version;
serverJson.packages[0].version=version;
await writeFile(serverJsonPath,JSON.stringify(serverJson,null,2)+"\n");

// Sync version into vscode-extension/package.json
const extPkgPath=path.join(rootDir,"vscode-extension","package.json");
const extPkg=JSON.parse(await readFile(extPkgPath,"utf8"));
extPkg.version=version;
await writeFile(extPkgPath,JSON.stringify(extPkg,null,2)+"\n");

const installScriptPath=path.join(rootDir,"scripts","install-user.ps1");
const installScript=(await readFile(installScriptPath,"utf8"))
	.replace(/\$packageVersion = \"[^\"]+\"/,`$packageVersion = \"${version}\"`);
await writeFile(installScriptPath,installScript);

await mkdir(distDir,{recursive: true});
await copyFile(sourceFile,targetFile);
await chmod(targetFile,0o755);
