@echo off
cd /d "%~dp0"
title WebtopKids Push Daemon
echo =========================================
echo  WebtopKids Push Daemon
echo  Auto-scrapes every 15 min
echo  Listens for phone triggers every 30 sec
echo  Close this window to stop the daemon
echo =========================================
echo.
node push_loop.mjs
pause
