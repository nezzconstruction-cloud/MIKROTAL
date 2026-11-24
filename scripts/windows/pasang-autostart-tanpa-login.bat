@echo off
rem MIKROTAL menyala otomatis saat komputer hidup, walau belum ada yang login (butuh izin Administrator)
rem Klik dua kali file ini.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Mode boot
echo.
pause
