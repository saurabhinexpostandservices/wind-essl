@echo off
:: Batch Wrapper to launch the native Windows Auto-Start Installer
setlocal EnableDelayedExpansion
cd /d "%~dp0"
call "%~dp0install-autostart.bat"
