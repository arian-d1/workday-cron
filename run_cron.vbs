Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""cd /d %USERPROFILE%\workday-cron && node index.js >> logs.txt 2>&1""", 0
Set WshShell = Nothing