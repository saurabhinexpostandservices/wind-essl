@echo off
:: ==============================================================================
:: eSSL Attendance Sync - True Windows Service Installer (using NSSM)
:: Registers the agent as a real service in services.msc (Automatic startup)
:: ==============================================================================
setlocal EnableDelayedExpansion
title eSSL Attendance Sync - Windows Service Setup

:: 1. Check Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0.."
set "APP_DIR=%CD%"
cd /d "%~dp0"

echo ==============================================================
echo       eSSL Attendance Sync Windows Service Setup (services.msc)
echo ==============================================================
echo Application Folder: %APP_DIR%
echo.

:: 2. Locate node.exe
echo [1/5] Finding Node.js executable...
set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%I"
)
if not defined NODE_EXE (
    if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
)
if not defined NODE_EXE (
    echo [ERROR] node.exe not found! Please install Node.js first.
    pause
    exit /b 1
)
echo       Found Node: %NODE_EXE%

:: 3. Verify dist/index.js
echo [2/5] Checking compiled files...
if not exist "%APP_DIR%\dist\index.js" (
    echo       Compiling project...
    pushd "%APP_DIR%"
    call npm run build
    popd
)
if not exist "%APP_DIR%\dist\index.js" (
    echo [ERROR] dist\index.js is missing!
    pause
    exit /b 1
)

:: 4. Ensure NSSM is available
echo [3/5] Locating NSSM (Service Manager)...
set "NSSM_EXE=%~dp0nssm.exe"
if not exist "%NSSM_EXE%" (
    for /f "delims=" %%I in ('where nssm.exe 2^>nul') do (
        if not exist "%NSSM_EXE%" set "NSSM_EXE=%%I"
    )
)

if not exist "%NSSM_EXE%" (
    echo       Downloading NSSM service wrapper...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $url = 'https://nssm.cc/release/nssm-2.24.zip'; $zip = '%~dp0nssm.zip'; try { Invoke-WebRequest -Uri $url -OutFile $zip; Expand-Archive $zip -DestinationPath '%~dp0nssm_temp' -Force; Copy-Item '%~dp0nssm_temp\nssm-2.24\win64\nssm.exe' '%NSSM_EXE%' -Force; Remove-Item $zip -Force; Remove-Item '%~dp0nssm_temp' -Recurse -Force; Write-Host 'Downloaded successfully.' } catch { Write-Host 'Download failed. Will try winget...' }" >nul 2>&1
)

if not exist "%NSSM_EXE%" (
    where winget >nul 2>&1
    if %errorLevel% equ 0 (
        echo       Installing NSSM via Windows Package Manager (winget)...
        winget install -e --id NSSM.NSSM --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
        for /f "delims=" %%I in ('where nssm.exe 2^>nul') do set "NSSM_EXE=%%I"
    )
)

:: Ensure logs directory
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
if not exist "%APP_DIR%\data" mkdir "%APP_DIR%\data"

set "SERVICE_NAME=ESSL_Attendance_Sync"

if exist "%NSSM_EXE%" (
    echo       Using NSSM: %NSSM_EXE%
    echo [4/5] Installing Windows Service '%SERVICE_NAME%'...
    "%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul 2>&1

    "%NSSM_EXE%" install "%SERVICE_NAME%" "%NODE_EXE%"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppParameters "\"%APP_DIR%\dist\index.js\" start"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppDirectory "%APP_DIR%"
    "%NSSM_EXE%" set "%SERVICE_NAME%" DisplayName "eSSL Attendance Sync Service"
    "%NSSM_EXE%" set "%SERVICE_NAME%" Description "Background synchronization service between eTimeTrackLite SQL Server and Team Management VPS"
    "%NSSM_EXE%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppStdout "%APP_DIR%\logs\service-stdout.log"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppStderr "%APP_DIR%\logs\service-stderr.log"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRestartDelay 10000

    echo [5/5] Starting Windows Service...
    "%NSSM_EXE%" start "%SERVICE_NAME%"
) else (
    echo [WARN] NSSM could not be downloaded automatically (no internet or blocked).
    echo Falling back to Windows Startup Folder auto-start...
    call "%~dp0install-autostart.bat"
    exit /b
)

timeout /t 3 /nobreak >nul

sc query "%SERVICE_NAME%" | findstr "STATE"
echo.
echo ==============================================================
echo [SUCCESS] Windows Service '%SERVICE_NAME%' is INSTALLED!
echo.
echo - You can view it anytime in 'services.msc'
echo - Status: Automatic startup on Windows boot
echo - Local Dashboard: http://127.0.0.1:8765
echo - To stop service: run 'scripts\stop-service.bat' or 'net stop %SERVICE_NAME%'
echo ==============================================================
pause
