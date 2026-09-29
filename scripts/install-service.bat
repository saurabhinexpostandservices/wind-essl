@echo off
:: ==============================================================================
:: eSSL Attendance Sync - Main Service Installer Wrapper
:: Launches the true Windows Service (services.msc) installer with elevation
:: ==============================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
call "%~dp0install-windows-service.bat"
