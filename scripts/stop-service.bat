@echo off
:: Stop eSSL Attendance Windows Service
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "SERVICE_NAME=ESSL_Attendance_Sync"
echo Stopping service %SERVICE_NAME%...
net stop %SERVICE_NAME%

:: Also kill if port 8765 is still bound
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [OK] Service stopped.
timeout /t 3 >nul
