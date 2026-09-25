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

# Check if NSSM is available in PATH or project
$nssm = Get-Command nssm -ErrorAction SilentlyContinue

if ($nssm) {
    Write-Host "  Registering service via NSSM..." -ForegroundColor Green
    & nssm install $ServiceName "$NodeExe" "$AgentScript start"
    & nssm set $ServiceName AppDirectory "$AppDir"
    & nssm set $ServiceName DisplayName "$ServiceDisplayName"
    & nssm set $ServiceName Description "eSSL Attendance Sync Background Service for eTimeTrackLite"
    & nssm set $ServiceName Start SERVICE_AUTO_START
    & nssm set $ServiceName AppStdout "$LogsDir\service-stdout.log"
    & nssm set $ServiceName AppStderr "$LogsDir\service-stderr.log"
    & nssm set $ServiceName AppRestartDelay 10000
} else {
    # Download or use WinSW wrapper
    $WinSwExe = Join-Path $AppDir "scripts\essl-service.exe"
    $WinSwXml = Join-Path $AppDir "scripts\essl-service.xml"
    Copy-Item "$PSScriptRoot\winsw.xml" $WinSwXml -Force

    if (-not (Test-Path $WinSwExe)) {
        Write-Host "  Downloading WinSW (Windows Service Wrapper)..." -ForegroundColor Yellow
        $winSwUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $winSwUrl -OutFile $WinSwExe
        } catch {
            Write-Warning "WinSW auto-download failed. Using sc.exe fallback."
        }
    }

    if (Test-Path $WinSwExe) {
        Write-Host "  Installing via WinSW..." -ForegroundColor Green
        & $WinSwExe install $WinSwXml
    } else {
        # sc.exe fallback
        Write-Host "  Configuring service via Windows sc.exe..." -ForegroundColor Green
        $binPath = "`"$NodeExe`" `"$AgentScript`" start"
        sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "$ServiceDisplayName"
        sc.exe failure $ServiceName reset= 3600 actions= restart/10000/restart/30000/restart/60000
    }
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
