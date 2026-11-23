@echo off
rem Lihat autostart MIKROTAL yang terpasang
rem Klik dua kali file ini.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Mode status
echo.
pause
