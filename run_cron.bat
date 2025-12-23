@echo off
REM Change directory first
cd %USERPROFILE%\workday-cron

REM Run node script and log output, without flashing a window
node index.js >> logs.txt 2>&1