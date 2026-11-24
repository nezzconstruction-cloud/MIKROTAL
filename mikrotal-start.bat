@echo off
rem ==========================================================================
rem  MIKROTAL - jalankan server
rem  Klik dua kali file ini untuk menyalakan MIKROTAL.
rem  Bila server berhenti karena error, server dinyalakan lagi otomatis.
rem  Tutup jendela ini (atau tekan Ctrl+C) untuk mematikan server.
rem
rem  Dipanggil dengan /service oleh Task Scheduler (autostart tanpa login):
rem  tanpa jendela, keluaran disimpan di logs\mikrotal.log
rem ==========================================================================
setlocal
cd /d "%~dp0"
set "SERVICE="
if /i "%~1"=="/service" set "SERVICE=1"
if defined SERVICE (
  if not exist "logs" mkdir "logs"
  set "LOG=logs\mikrotal.log"
)
title MIKROTAL

where node >nul 2>nul
if errorlevel 1 (
  call :pesan "Node.js tidak ditemukan. Pasang Node.js 22 LTS atau lebih baru dari https://nodejs.org lalu coba lagi."
  goto gagal
)
if not exist ".env" (
  call :pesan "File .env belum ada. Salin .env.example menjadi .env, lalu isi APP_SECRET dan ADMIN_PASSWORD."
  goto gagal
)
if not exist "node_modules" (
  call :pesan "Memasang paket (npm install), hanya sekali..."
  call :npm install || goto gagal
)
set "PERLU_BUILD="
if not exist "server\dist\index.js" set "PERLU_BUILD=1"
if not exist "web\dist\index.html" set "PERLU_BUILD=1"
if defined PERLU_BUILD (
  call :pesan "Membangun aplikasi (npm run build), hanya sekali..."
  call :npm run build || goto gagal
)

set "PORT=8080"
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" ".env"') do set "PORT=%%b"

:jalan
if defined SERVICE call :putar_log
call :pesan "MIKROTAL berjalan di http://localhost:%PORT% (%date% %time%)"
if not defined SERVICE echo Jangan tutup jendela ini selama MIKROTAL dipakai.
call :npm start
call :pesan "Server berhenti (%date% %time%). Dinyalakan lagi dalam 10 detik..."
rem ping dipakai sebagai jeda karena "timeout" tidak jalan tanpa jendela
ping -n 11 127.0.0.1 >nul
goto jalan

:gagal
if not defined SERVICE pause
exit /b 1

rem ---- fungsi bantu ------------------------------------------------------
rem (tanpa blok kurung, karena pesan boleh berisi tanda kurung)
:pesan
if defined SERVICE goto pesan_log
echo(%~1
exit /b 0
:pesan_log
>>"%LOG%" echo(%~1
exit /b 0

:npm
if defined SERVICE goto npm_log
call npm %*
exit /b %errorlevel%
:npm_log
call npm %* >>"%LOG%" 2>&1
exit /b %errorlevel%

:putar_log
rem log lebih dari 10 MB disimpan sebagai mikrotal.old.log
if not exist "%LOG%" exit /b 0
for %%F in ("%LOG%") do if %%~zF GTR 10485760 move /y "%LOG%" "logs\mikrotal.old.log" >nul
exit /b 0
