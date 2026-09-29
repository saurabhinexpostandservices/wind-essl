@echo off
:: Uninstall eSSL Attendance Windows Service
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "WINSW_EXE=%~dp0essl-service.exe"

echo Removing eSSL Attendance Sync Windows Service...
if exist "%WINSW_EXE%" (
    "%WINSW_EXE%" stop >nul 2>&1
    "%WINSW_EXE%" uninstall
) else (
    net stop "essl-attendance-sync" >nul 2>&1
    sc.exe delete "essl-attendance-sync" >nul 2>&1
    net stop "ESSL_Attendance_Sync" >nul 2>&1
    sc.exe delete "ESSL_Attendance_Sync" >nul 2>&1
)

echo [OK] Windows Service uninstalled completely from services.msc.
pause
