@echo off
:: ==============================================================================
:: Uninstall eSSL Attendance Sync Auto-Start
:: Removes from Windows Startup folder and Task Scheduler, and stops agent
:: ==============================================================================
setlocal EnableDelayedExpansion
title Uninstall eSSL Attendance Auto-Start

echo ==============================================================
echo       Uninstalling eSSL Attendance Auto-Start                 
echo ==============================================================

:: 1. Remove from Windows Startup folder
set "STARTUP_VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\eSSL_Attendance_Sync.vbs"
if exist "%STARTUP_VBS%" (
    del /f /q "%STARTUP_VBS%" >nul 2>&1
    echo [OK] Removed from Windows Startup folder.
)

:: 2. Remove from Task Scheduler
schtasks /end /tn "ESSL_Attendance_Sync" >nul 2>&1
schtasks /delete /tn "ESSL_Attendance_Sync" /f >nul 2>&1
echo [OK] Removed Task Scheduler entry.

:: 3. Stop running process
call "%~dp0stop-background.bat"

echo.
echo ==============================================================
echo [SUCCESS] eSSL Attendance Sync has been uninstalled from auto-start.
echo ==============================================================
pause
