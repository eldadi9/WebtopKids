@echo off
:: install_watchdog.bat — Registers the watchdog as a Windows Task Scheduler task.
:: Run ONCE as Administrator to install. After that it runs automatically.
::
:: What it creates:
::   Task name: WebtopKids-Watchdog
::   Trigger:   At logon + every 5 minutes
::   Action:    watchdog.bat (checks if push_loop is alive, restarts if not)

cd /d "%~dp0"
set TASK_NAME=WebtopKids-Watchdog
set SCRIPT_PATH=%~dp0watchdog.bat

echo.
echo =========================================
echo  WebtopKids Watchdog Installer
echo =========================================
echo.
echo Task name: %TASK_NAME%
echo Script:    %SCRIPT_PATH%
echo.

:: Delete existing task if present
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create task: run at logon, then repeat every 5 minutes indefinitely
schtasks /create /tn "%TASK_NAME%" ^
  /tr "cmd /c \"%SCRIPT_PATH%\"" ^
  /sc onlogon ^
  /ri 5 ^
  /du 9999:59 ^
  /rl HIGHEST ^
  /f

if %errorlevel% == 0 (
    echo.
    echo [OK] Watchdog task installed successfully!
    echo      It will run at login and every 5 minutes automatically.
    echo.
    echo Running first check now...
    call watchdog.bat
) else (
    echo.
    echo [ERROR] Failed to install task. Try running as Administrator.
)

pause
