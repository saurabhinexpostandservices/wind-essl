@echo off
:: ==============================================================================
:: eSSL Attendance Sync Agent - Windows Auto-Start Installer
:: Configures the sync agent to run automatically in the background on Windows boot
:: ==============================================================================
setlocal EnableDelayedExpansion
title eSSL Attendance Sync - Auto-Start Installer

cd /d "%~dp0.."
set "APP_DIR=%CD%"
cd /d "%~dp0"

echo ==============================================================
echo       eSSL Attendance Sync Windows Auto-Start Setup           
echo ==============================================================
echo Application Folder: %APP_DIR%
echo.

:: 1. Verify Node.js availability
echo [1/6] Checking Node.js installation...
where node.exe >nul 2>&1
if %errorLevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
        set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
    ) else (
        echo [ERROR] Node.js could not be found! Please install Node.js (https://nodejs.org).
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo       Found Node.js %NODE_VER%

:: 2. Verify compilation (dist/index.js)
echo [2/6] Checking application build...
if not exist "%APP_DIR%\dist\index.js" (
    echo       dist/index.js not found. Compiling TypeScript now...
    pushd "%APP_DIR%"
    call npm run build
    popd
    if not exist "%APP_DIR%\dist\index.js" (
        echo [ERROR] TypeScript compilation failed! Run 'npm install' and 'npm run build' first.
        pause
        exit /b 1
    )
)
echo       Build verified.

:: 3. Prepare directories
if not exist "%APP_DIR%\data" mkdir "%APP_DIR%\data"
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"

:: 4. Stop existing background instances if running
echo [3/6] Stopping any previous background instances...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
powershell -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dist*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

:: 5. Install to Windows Startup Folder (Method 1: 100%% reliable, user-level auto-boot)
echo [4/6] Registering auto-start in Windows Startup folder...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_VBS=%STARTUP_FOLDER%\eSSL_Attendance_Sync.vbs"

(
    echo ' eSSL Attendance Sync Auto-Start Launcher
    echo Set shell = CreateObject^("WScript.Shell"^)
    echo shell.Run "wscript.exe """ ^& "%APP_DIR%\scripts\start-hidden.vbs" ^& """", 0, False
) > "%STARTUP_VBS%"

if exist "%STARTUP_VBS%" (
    echo       [OK] Added to Windows Startup folder:
    echo            %STARTUP_VBS%
) else (
    echo       [WARN] Could not write to Startup folder.
)

:: 6. Register in Windows Task Scheduler (Method 2: Highest privilege task)
echo [5/6] Registering Windows Task Scheduler entry...
schtasks /create /tn "ESSL_Attendance_Sync" /tr "wscript.exe \"%APP_DIR%\scripts\start-hidden.vbs\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1
if %errorLevel% equ 0 (
    echo       [OK] Task Scheduler registered: ESSL_Attendance_Sync ^(Trigger: User Logon, Highest Privileges^)
) else (
    echo       [INFO] Task Scheduler registration skipped ^(requires Admin^). Startup folder will handle auto-start.
)

:: 7. Launch the background agent right now
echo [6/6] Launching eSSL Attendance Agent in background now...
wscript.exe "%APP_DIR%\scripts\start-hidden.vbs"

echo       Waiting for agent to initialize...
timeout /t 4 /nobreak >nul

:: 8. Verify the background process is responding
set "IS_RUNNING=0"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765" ^| findstr "LISTENING"') do (
    set "IS_RUNNING=1"
)

if "!IS_RUNNING!"=="1" (
    echo.
    echo ==============================================================
    echo  [SUCCESS] eSSL Attendance Sync Agent is RUNNING in background!
    echo ==============================================================
    echo  * Automatically starts on Windows boot / login
    echo  * Runs silently with NO Command Prompt window open
    echo  * Local Dashboard: http://127.0.0.1:8765
    echo  * Logs folder:     %APP_DIR%\logs
    echo  * To stop:         run 'scripts\stop-background.bat'
    echo ==============================================================
    echo.
    echo Opening dashboard in your web browser...
    start http://127.0.0.1:8765
) else (
    echo.
    echo ==============================================================
    echo  [NOTICE] Agent launched. Checking boot logs:
    echo ==============================================================
    if exist "%APP_DIR%\logs\agent-boot.log" (
        type "%APP_DIR%\logs\agent-boot.log"
    )
    echo.
    echo If the dashboard does not open, check '%APP_DIR%\logs' for details.
)

echo.
echo Press any key to close this installer window...
pause >nul
