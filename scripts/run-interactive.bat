@echo off
:: ==============================================================================
:: Run eSSL Attendance Sync Agent Interactively (Visible Command Prompt Window)
:: Use this when you want to see live logs and console output directly on screen.
:: ==============================================================================
title eSSL Attendance Sync Agent (Live Terminal)
cd /d "%~dp0.."

echo ==============================================================
echo       eSSL Attendance Sync Agent - Live Console Mode         
echo ==============================================================
echo Folder: %CD%
echo.

node dist/index.js start

pause
