@echo off
:: Uninstall eSSL Attendance Windows Service
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "SERVICE_NAME=ESSL_Attendance_Sync"
set "NSSM_EXE=%~dp0nssm.exe"

echo Removing Windows Service %SERVICE_NAME%...
net stop %SERVICE_NAME% >nul 2>&1

if exist "%NSSM_EXE%" (
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm
) else (
    sc.exe delete "%SERVICE_NAME%"
)

sc.exe delete "essl-attendance-sync" >nul 2>&1

echo [OK] Windows Service removed.
pause
