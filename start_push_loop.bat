@echo off
REM הרצת push_loop ברקע (ל-Task Scheduler). אותה תיקייה כמו watchdog.
cd /d "%~dp0"
start "WebtopKids PushLoop" /MIN cmd /c "node push_loop.mjs >> push_loop_run.log 2>&1"
