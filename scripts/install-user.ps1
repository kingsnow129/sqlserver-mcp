param(
  [switch]$SkipUserMcpConfig
)

$ErrorActionPreference = "Stop"

$packageName = "@kingsnow129/database-mcp"
$packageVersion = "0.4.2"
$installRoot = Join-Path $HOME ".mcp-servers\database-mcp"
$envTarget = Join-Path $installRoot ".env"
$profilesTarget = Join-Path $installRoot "profiles.json"
$userMcpConfigPath = Join-Path $env:APPDATA "Code\User\mcp.json"

$serverConfig = @{
  type = "stdio"
  command = "node"
  args = @(
    '${userHome}/.mcp-servers/database-mcp/node_modules/@kingsnow129/database-mcp/dist/server.js'
  )
  envFile = '${userHome}/.mcp-servers/database-mcp/.env'
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

  if (-not (Test-Path $profilesTarget)) {
    $profiles = [pscustomobject]@{
      defaultServer = "local-server"
      currentServer = "local-server"
      currentDatabase = "master"
      servers = [pscustomobject]@{
        "local-server" = [pscustomobject]@{
          engine = "sqlserver"
          host = "localhost"
          port = 1433
          integratedAuth = $false
          user = "sa"
          password = ""
          encrypt = $true
          trustServerCertificate = $true
          databases = @(
            [pscustomobject]@{
              name = "master"
              readOnly = $true
              maxRows = 200
            }
          )
        }
      }
    }

    $profiles | ConvertTo-Json -Depth 10 | Set-Content -Path $profilesTarget -Encoding UTF8
    Write-Host "Created profiles.json at: $profilesTarget"
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

  if ($mcpConfig.servers.PSObject.Properties.Name -contains "databaseMcp") {
    $mcpConfig.servers.databaseMcp = [pscustomobject]$serverConfig
  } else {
    $mcpConfig.servers | Add-Member -NotePropertyName databaseMcp -NotePropertyValue ([pscustomobject]$serverConfig)
  }
  # Backward compatibility for existing users/tools.
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
Write-Host "Alias profile source: $profilesTarget"
Write-Host "Open Command Palette and run: MCP: List Servers"
Write-Host "Select databaseMcp (or sqlserverMcp) to Start/Stop/Restart or Show Output logs."
