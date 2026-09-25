# PowerShell Service Uninstaller for eSSL Attendance Sync Agent
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

$ServiceName = "essl-attendance-sync"

Write-Host "Stopping service $ServiceName..." -ForegroundColor Yellow
try {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
} catch {}

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    & nssm remove $ServiceName confirm
} else {
    $AppDir = Resolve-Path "$PSScriptRoot\.."
    $WinSwExe = Join-Path $AppDir "scripts\essl-service.exe"
    $WinSwXml = Join-Path $AppDir "scripts\essl-service.xml"
    if (Test-Path $WinSwExe) {
        & $WinSwExe uninstall $WinSwXml
    } else {
        sc.exe delete $ServiceName
    }
}

Write-Host "Service $ServiceName successfully removed." -ForegroundColor Green
