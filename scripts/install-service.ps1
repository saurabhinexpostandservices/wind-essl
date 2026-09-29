# PowerShell Service Installer for eSSL Attendance Sync Agent
# Requires Administrator Privileges

$ErrorActionPreference = "Stop"

function Test-Administrator {
    $user = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($user)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Warning "Administrator rights required. Relaunching as Administrator..."
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     eSSL Attendance Sync Service Windows Installer       " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$AppDir = Resolve-Path "$PSScriptRoot\.."
Set-Location $AppDir

# 1. Verify Node.js
Write-Host "[1/6] Verifying Node.js environment..." -ForegroundColor Yellow
try {
    $nodeVersion = node -v
    Write-Host "  Found Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed or not in PATH! Please install Node.js (LTS v20+ recommended) first."
}

# 2. Setup Directories
Write-Host "[2/6] Preparing directories..." -ForegroundColor Yellow
$DataDir = Join-Path $AppDir "data"
$LogsDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

# 3. Environment configuration check
Write-Host "[3/6] Checking configuration..." -ForegroundColor Yellow
$EnvFile = Join-Path $AppDir ".env"
$EnvExample = Join-Path $AppDir ".env.example"

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Warning "Created .env from .env.example. PLEASE EDIT .env with your SQL Server and VPS credentials!"
    } else {
        Write-Error ".env and .env.example not found."
    }
} else {
    Write-Host "  Found .env configuration." -ForegroundColor Green
}

# 4. Install dependencies and compile TypeScript
Write-Host "[4/6] Installing dependencies and compiling project..." -ForegroundColor Yellow
npm install --production=false
npm run build

# 5. Service registration using WinSW or NSSM
Write-Host "[5/6] Registering Windows Service: 'ESSL Attendance Sync'..." -ForegroundColor Yellow

$ServiceName = "essl-attendance-sync"
$ServiceDisplayName = "ESSL Attendance Sync"
$NodeExe = (Get-Command node).Source
$AgentScript = Join-Path $AppDir "dist\index.js"

$WinSwExe = Join-Path $AppDir "scripts\essl-service.exe"
$WinSwXml = Join-Path $AppDir "scripts\essl-service.xml"

# Generate tailored XML with exact absolute paths for node.exe and app directory
$xmlContent = @"
<service>
  <id>$ServiceName</id>
  <name>$ServiceDisplayName</name>
  <description>Production eSSL Biometric Attendance Synchronization Background Service for eTimeTrackLite</description>
  <executable>$NodeExe</executable>
  <arguments>`"$AgentScript`" start</arguments>
  <workingdirectory>$AppDir</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>false</delayedAutoStart>
  <logpath>$LogsDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>14</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <env name="NODE_ENV" value="production"/>
</service>
"@
Set-Content -Path $WinSwXml -Value $xmlContent -Encoding UTF8

if (Test-Path $WinSwExe) {
    Write-Host "  Installing via bundled WinSW ($WinSwExe)..." -ForegroundColor Green
    # Stop & remove existing registration
    & $WinSwExe stop 2>$null
    & $WinSwExe uninstall 2>$null

    & $WinSwExe install $WinSwXml
    & $WinSwExe start
} else {
    Write-Warning "WinSW wrapper not found. Using Windows Task Scheduler ONSTART..."
    schtasks /create /tn "$ServiceName" /tr "`"$NodeExe`" `"$AgentScript`" start" /sc ONSTART /ru "SYSTEM" /rl HIGHEST /f
}

# 6. Start the service
Write-Host "[6/6] Starting the service..." -ForegroundColor Yellow
try {
    Start-Service -Name $ServiceName
    Write-Host "Service '$ServiceName' started successfully!" -ForegroundColor Green
} catch {
    Write-Warning "Could not start service automatically. Please start it using 'net start $ServiceName' or via services.msc."
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Installation Completed!                                " -ForegroundColor Green
Write-Host "  Service Status:        Get-Service $ServiceName        " -ForegroundColor White
Write-Host "  Local Diagnostic UI:   http://127.0.0.1:8765           " -ForegroundColor White
Write-Host "  Logs Directory:        $LogsDir                        " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
