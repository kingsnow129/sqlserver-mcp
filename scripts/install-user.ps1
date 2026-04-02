param(
  [switch]$SkipUserMcpConfig
)

$ErrorActionPreference = "Stop"

$packageName = "@kingsnow129/sqlserver-mcp"
$packageVersion = "0.2.1"
$installRoot = Join-Path $HOME ".mcp-servers\sqlserver-mcp"
$envTarget = Join-Path $installRoot ".env"
$userMcpConfigPath = Join-Path $env:APPDATA "Code\User\mcp.json"

$serverConfig = @{
  type = "stdio"
  command = "node"
  args = @(
    '${userHome}/.mcp-servers/sqlserver-mcp/node_modules/@kingsnow129/sqlserver-mcp/src/server.js'
  )
  envFile = '${userHome}/.mcp-servers/sqlserver-mcp/.env'
}

Write-Host "Installing $packageName@$packageVersion into $installRoot"

if (-not (Test-Path $installRoot)) {
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
}

Push-Location $installRoot
try {
  if (-not (Test-Path (Join-Path $installRoot "package.json"))) {
    npm init -y | Out-Null
  }

  npm install --save-exact "$packageName@$packageVersion"

  $sourceEnv = Join-Path $PSScriptRoot "..\.env.example"
  if ((Test-Path $sourceEnv) -and (-not (Test-Path $envTarget))) {
    Copy-Item $sourceEnv $envTarget
    Write-Host "Created .env from .env.example at: $envTarget"
  }
}
finally {
  Pop-Location
}

if (-not $SkipUserMcpConfig) {
  $mcpConfig = $null

  if (Test-Path $userMcpConfigPath) {
    $raw = Get-Content -Path $userMcpConfigPath -Raw
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
      $mcpConfig = $raw | ConvertFrom-Json
    }
  }

  if ($null -eq $mcpConfig) {
    $mcpConfig = [pscustomobject]@{}
  }

  if (-not ($mcpConfig.PSObject.Properties.Name -contains "servers") -or $null -eq $mcpConfig.servers) {
    $mcpConfig | Add-Member -NotePropertyName servers -NotePropertyValue ([pscustomobject]@{})
  }

  if ($mcpConfig.servers.PSObject.Properties.Name -contains "sqlserverMcp") {
    $mcpConfig.servers.sqlserverMcp = [pscustomobject]$serverConfig
  } else {
    $mcpConfig.servers | Add-Member -NotePropertyName sqlserverMcp -NotePropertyValue ([pscustomobject]$serverConfig)
  }

  $parent = Split-Path -Parent $userMcpConfigPath
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $mcpConfig | ConvertTo-Json -Depth 15 | Set-Content -Path $userMcpConfigPath -Encoding UTF8
  Write-Host "Updated user MCP config at: $userMcpConfigPath"
}

Write-Host ""
Write-Host "Done. Single source of env config: $envTarget"
Write-Host "Open Command Palette and run: MCP: List Servers"
Write-Host "Select sqlserverMcp to Start/Stop/Restart or Show Output logs."
