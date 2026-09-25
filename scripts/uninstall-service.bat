@echo off
:: Batch Wrapper to launch PowerShell uninstaller as Administrator
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo Requesting Administrator privileges to uninstall service...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0uninstall-service.ps1\"\"'"
pause
