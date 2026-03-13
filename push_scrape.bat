@echo off
cd /d "%~dp0"
title WebtopKids - Scrape and Push (One-Shot)
echo =========================================
echo  WebtopKids - Scrape + Push to VPS
echo  Run node push_scrape.mjs
echo =========================================
echo.
node push_scrape.mjs
echo.
echo Done. Exit code: %ERRORLEVEL%
pause
