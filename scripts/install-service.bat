@echo off
:: Batch Wrapper to launch PowerShell installer as Administrator
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0install-service.ps1\"\"'"
pause
