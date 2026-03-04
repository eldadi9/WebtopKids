@echo off
title WebtopKids — סריקת פורטל
cd /d "%~dp0"
echo.
echo ========================================
echo  סריקת כל החלונות באתר Webtop
echo ========================================
echo  יפתח דפדפן, יבדוק כל דף בתפריט,
echo  וישמור דוח discovery.json
echo ========================================
echo.
set WEBTOP_SCAN=true
node webtop_scan.mjs > discovery.json 2>&1
echo.
echo הדוח נשמר ב-discovery.json
type discovery.json
pause
