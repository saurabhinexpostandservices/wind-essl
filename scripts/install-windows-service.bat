@echo off
:: ==============================================================================
:: eSSL Attendance Sync - Official Windows Service Installer (WinSW)
:: Registers as a true native Windows Service in services.msc with Automatic startup
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
set "SCRIPTS_DIR=%CD%"

echo ==============================================================
echo       eSSL Attendance Sync Windows Service Setup (services.msc)
echo ==============================================================
echo Application Directory: %APP_DIR%
echo Scripts Directory:     %SCRIPTS_DIR%
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
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
)
if not defined NODE_EXE (
    echo [ERROR] node.exe not found! Please install Node.js (https://nodejs.org).
    pause
    exit /b 1
)
echo       Found Node: "%NODE_EXE%"

:: 3. Verify dist/index.js compilation
echo [2/5] Verifying application build...
if not exist "%APP_DIR%\dist\index.js" (
    echo       dist\index.js not found. Compiling TypeScript now...
    pushd "%APP_DIR%"
    call npm run build
    popd
)
if not exist "%APP_DIR%\dist\index.js" (
    echo [ERROR] TypeScript compilation failed or dist\index.js is missing!
    pause
    exit /b 1
)
echo       Build verified: "%APP_DIR%\dist\index.js"

:: 4. Ensure directories exist
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
if not exist "%APP_DIR%\data" mkdir "%APP_DIR%\data"

:: 5. Generate tailored essl-service.xml with exact paths
echo [3/5] Generating Service Configuration (essl-service.xml)...
set "XML_FILE=%SCRIPTS_DIR%\essl-service.xml"

(
    echo ^<service^>
    echo   ^<id^>essl-attendance-sync^</id^>
    echo   ^<name^>eSSL Attendance Sync^</name^>
    echo   ^<description^>Production eSSL Biometric Attendance Synchronization Background Service for eTimeTrackLite^</description^>
    echo   ^<executable^>%NODE_EXE%^</executable^>
    echo   ^<arguments^>"%APP_DIR%\dist\index.js" start^</arguments^>
    echo   ^<workingdirectory^>%APP_DIR%^</workingdirectory^>
    echo   ^<startmode^>Automatic^</startmode^>
    echo   ^<delayedAutoStart^>false^</delayedAutoStart^>
    echo   ^<logpath^>%APP_DIR%\logs^</logpath^>
    echo   ^<log mode="roll-by-size"^>
    echo     ^<sizeThreshold^>10240^</sizeThreshold^>
    echo     ^<keepFiles^>14^</keepFiles^>
    echo   ^</log^>
    echo   ^<onfailure action="restart" delay="10 sec"/^>
    echo   ^<onfailure action="restart" delay="30 sec"/^>
    echo   ^<onfailure action="restart" delay="60 sec"/^>
    echo   ^<resetfailure^>1 hour^</resetfailure^>
    echo   ^<env name="NODE_ENV" value="production"/^>
    echo ^</service^>
) > "%XML_FILE%"

echo       Configuration written to "%XML_FILE%"

:: 6. Register & Start via bundled WinSW wrapper
echo [4/5] Installing Windows Service into services.msc...
set "WINSW_EXE=%SCRIPTS_DIR%\essl-service.exe"

if not exist "%WINSW_EXE%" (
    echo [ERROR] essl-service.exe wrapper not found in scripts folder!
    pause
    exit /b 1
)

:: Stop any legacy services first
net stop "ESSL_Attendance_Sync" >nul 2>&1
sc.exe delete "ESSL_Attendance_Sync" >nul 2>&1
"%WINSW_EXE%" stop >nul 2>&1
"%WINSW_EXE%" uninstall >nul 2>&1

:: Install service
"%WINSW_EXE%" install "%XML_FILE%"
if %errorLevel% neq 0 (
    echo [WARN] WinSW install returned code %errorLevel%. Retrying with default arguments...
    "%WINSW_EXE%" install
)

echo [5/5] Starting Windows Service...
"%WINSW_EXE%" start
if %errorLevel% neq 0 (
    echo [INFO] Attempting net start...
    net start "essl-attendance-sync"
)

:: Allow service 4 seconds to boot
timeout /t 4 /nobreak >nul

echo.
sc query "essl-attendance-sync" | findstr /i "STATE"
echo.

:: Verify local HTTP diagnostic server
set "IS_RUNNING=0"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765" ^| findstr "LISTENING"') do (
    set "IS_RUNNING=1"
)

echo ==============================================================
if "!IS_RUNNING!"=="1" (
    echo [SUCCESS] Windows Service 'essl-attendance-sync' is RUNNING!
) else (
    echo [NOTICE] Windows Service 'essl-attendance-sync' is INSTALLED!
)
echo.
echo - Service Name:     eSSL Attendance Sync (essl-attendance-sync)
echo - Visible In:       services.msc (Startup type: Automatic)
echo - Local Dashboard:  http://127.0.0.1:8765
echo - Service Logs:     %APP_DIR%\logs\
echo.
echo Useful Commands:
echo - Restart service:  scripts\restart-service.bat
echo - Stop service:     scripts\stop-service.bat
echo - Uninstall:        scripts\uninstall-service.bat
echo ==============================================================
pause
