@echo off
rem Hapus autostart MIKROTAL (keduanya)
rem Klik dua kali file ini.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Mode remove
echo.
pause
