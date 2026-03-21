@echo off
cd /d "%~dp0"

REM לא מפעילים Keep-Alive בדפדפן — גורם לחלונות Chrome ולא נחוץ עם webtop_api_fetch.py
REM אם חוזרים ל-Playwright בלבד: הסר REM מהשורות הבאות
REM start "WebtopKids Keep-Alive" /MIN cmd /c "node webtop_keepalive.mjs >> keepalive.log 2>&1"
REM timeout /t 3 /nobreak >nul

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
