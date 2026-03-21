@echo off
:: watchdog.bat — Auto-recovery watchdog for push_loop.mjs
:: Run every 5 minutes via Windows Task Scheduler.
:: If push_loop is dead (stale/missing lock), clears the lock and restarts it.

cd /d "%~dp0"
set LOCK=.push_loop.lock
set LOGFILE=watchdog.log

:: Log timestamp
echo [%date% %time%] Watchdog check >> %LOGFILE%

:: If no lock file, process is definitely not running
if not exist %LOCK% goto START_LOOP

:: Read the PID from lock file
set /p LOCK_PID=<%LOCK%

:: Check if that PID is alive using tasklist + findstr
tasklist /FI "PID eq %LOCK_PID%" 2>nul | findstr /C:"%LOCK_PID%" >nul
if %errorlevel% == 0 (
    echo [%date% %time%] push_loop is alive (PID %LOCK_PID%) — no action needed >> %LOGFILE%
    exit /b 0
)

:: PID is dead — stale lock
echo [%date% %time%] Stale lock detected (PID %LOCK_PID% dead) — clearing and restarting >> %LOGFILE%
del %LOCK% 2>nul

:START_LOOP
echo [%date% %time%] Starting push_loop.mjs... >> %LOGFILE%
start /MIN "WebtopKids Daemon" cmd /c "node push_loop.mjs >> keepalive.log 2>&1"
echo [%date% %time%] push_loop.mjs launched >> %LOGFILE%
exit /b 0
