@echo off
cd /d "%~dp0"

title WebtopKids — Keep-Alive
start "WebtopKids Keep-Alive" /MIN cmd /c "node webtop_keepalive.mjs >> keepalive.log 2>&1"

timeout /t 3 /nobreak >nul

title WebtopKids Push Daemon
echo =========================================
echo  WebtopKids Push Daemon
echo  Keep-Alive: pings every 8 min (bg window)
echo  Auto-scrapes every 15 min
echo  Listens for phone triggers every 30 sec
echo  Close this window to stop the daemon
echo =========================================
echo.
node push_loop.mjs
pause
