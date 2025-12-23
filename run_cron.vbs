Set WshShell = CreateObject("WScript.Shell")

' Wait 10 seconds (10000 milliseconds) before running to establish connection with internet
WScript.Sleep 10000

WshShell.Run "cmd /c ""cd /d %USERPROFILE%\workday-cron && node index.js >> logs.txt 2>&1""", 0
Set WshShell = Nothing