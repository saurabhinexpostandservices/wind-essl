@echo off
:: Restart eSSL Attendance Windows Service
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "WINSW_EXE=%~dp0essl-service.exe"

echo Restarting eSSL Attendance Sync Service...
if exist "%WINSW_EXE%" (
    "%WINSW_EXE%" restart
) else (
    net stop "essl-attendance-sync" >nul 2>&1
    net start "essl-attendance-sync"
)

timeout /t 3 /nobreak >nul
sc query "essl-attendance-sync" | findstr /i "STATE"
echo [OK] Service restarted.
pause
