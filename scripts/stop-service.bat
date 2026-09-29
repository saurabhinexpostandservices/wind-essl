@echo off
:: Stop eSSL Attendance Windows Service
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "WINSW_EXE=%~dp0essl-service.exe"

echo Stopping eSSL Attendance Sync Service...
if exist "%WINSW_EXE%" (
    "%WINSW_EXE%" stop
) else (
    net stop "essl-attendance-sync" >nul 2>&1
    net stop "ESSL_Attendance_Sync" >nul 2>&1
)

:: Also free port 8765 if process hung
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [OK] Service stopped.
timeout /t 3 >nul
