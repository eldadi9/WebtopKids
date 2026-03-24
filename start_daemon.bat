@echo off
cd /d "%~dp0"

REM לא מפעילים Keep-Alive בדפדפן — גורם לחלונות Chrome ולא נחוץ עם webtop_api_fetch.py
REM אם חוזרים ל-Playwright בלבד: הסר REM מהשורות הבאות
REM start "WebtopKids Keep-Alive" /MIN cmd /c "node webtop_keepalive.mjs >> keepalive.log 2>&1"
REM timeout /t 3 /nobreak >nul

REM נקה lock file תקוע אם ה-PID לא קיים יותר
if exist .push_loop.lock (
  set /p LOCK_PID=<.push_loop.lock
  tasklist /FI "PID eq %LOCK_PID%" 2>nul | find "%LOCK_PID%" >nul
  if errorlevel 1 (
    echo [startup] Removing stale lock file (PID %LOCK_PID% not running)
    del .push_loop.lock
  )
)

title WebtopKids Push Daemon
echo =========================================
echo  WebtopKids Push Daemon
echo  Python API — בלי חלון Chrome קבוע
echo  Auto-scrapes every 15 min + quiet token refresh
echo  Listens for phone triggers every 30 sec
echo  Close this window to stop the daemon
echo =========================================
echo.
node push_loop.mjs
pause
