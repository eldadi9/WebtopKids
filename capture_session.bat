@echo off
title WebtopKids — Capture Session (Manual Login)
cd /d "%~dp0"

echo.
echo ========================================
echo  WebtopKids — Capture Session
echo ========================================
echo  Browser will open. Log in manually
echo  (username, password, solve CAPTCHA).
echo  Profile saved to .webtop_profile
echo ========================================
echo.

set WEBTOP_CAPTURE=true
node webtop_scrape.mjs

echo.
pause
