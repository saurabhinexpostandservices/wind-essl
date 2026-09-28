@echo off
:: ==============================================================================
:: Stop eSSL Attendance Sync Agent background process
:: ==============================================================================
setlocal EnableDelayedExpansion
title Stop eSSL Attendance Agent

echo Stopping eSSL Attendance Sync Agent...

:: 1. Stop process listening on port 8765
set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    set "KILLED=1"
)

:: 2. Terminate any node process running dist/index.js
powershell -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dist*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host 'Stopped PID:' $_.ProcessId }" >nul 2>&1

:: 3. Stop Task Scheduler task if active
schtasks /end /tn "ESSL_Attendance_Sync" >nul 2>&1

echo [OK] eSSL Attendance Sync Agent has been stopped.
echo To start again: run 'scripts\start-hidden.vbs' or 'scripts\install-autostart.bat'
timeout /t 3 >nul
