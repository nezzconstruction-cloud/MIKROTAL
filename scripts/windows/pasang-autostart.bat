@echo off
rem MIKROTAL menyala otomatis setiap kali Anda login ke Windows
rem Klik dua kali file ini.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Mode login
echo.
pause
