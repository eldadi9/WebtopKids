@echo off
REM ============================================================
REM WebtopKids DEV server on localhost:3002
REM Uses .env.dev (NOT .env)
REM ============================================================
cd /d "%~dp0\.."
set DOTENV_PATH=.env.dev
set USERS_FILE_OVERRIDE=users.dev.json
echo Starting WebtopKids DEV on http://localhost:3002 ...
node server.js
