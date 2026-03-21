@echo off
:: watchdog.bat — מנגנון Windows בלבד / Windows-only process guard
::
:: זה לא קשור ל-API, לדפדפן או ל-CAPTCHA. זה רק בודק אם תהליך Node `push_loop.mjs`
:: עדיין רץ אחרי אתחול מחשב / קריסה. אם לא — מפעיל אותו מחדש.
::
:: Not related to Webtop API vs browser. It only restarts push_loop.mjs if the
:: Node process died (reboot, crash, closed window). Safe to keep or remove from Task Scheduler.

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
start /MIN "WebtopKids Daemon" cmd /c "node push_loop.mjs >> push_loop_run.log 2>&1"
echo [%date% %time%] push_loop.mjs launched >> %LOGFILE%
exit /b 0
