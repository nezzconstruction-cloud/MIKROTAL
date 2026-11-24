<#
  MIKROTAL - atur autostart di Windows.
  Biasanya tidak dijalankan langsung: klik dua kali salah satu file .bat di folder ini.

    -Mode login   : MIKROTAL menyala setelah Anda login ke Windows (jendela kecil di taskbar).
    -Mode boot    : MIKROTAL menyala saat komputer hidup, walau belum ada yang login
                    (Task Scheduler, akun SYSTEM, butuh izin Administrator). Log: logs\mikrotal.log
    -Mode remove  : hapus kedua jenis autostart.
    -Mode status  : tampilkan autostart yang terpasang.
#>
param(
  [ValidateSet('login', 'boot', 'remove', 'status')]
  [string]$Mode = 'status',
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$StartBat = Join-Path $Root 'mikrotal-start.bat'
$TaskName = 'MIKROTAL'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'MIKROTAL.lnk'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-MikrotalTask {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Show-Status {
  Write-Host ''
  Write-Host "Folder MIKROTAL : $Root"
  if (Test-Path $Shortcut) { Write-Host 'Saat login      : TERPASANG' } else { Write-Host 'Saat login      : tidak' }
  $t = Get-MikrotalTask
  if ($t) { Write-Host "Saat komputer hidup (Task Scheduler): TERPASANG, status $($t.State)" } else { Write-Host 'Saat komputer hidup (Task Scheduler): tidak' }
}

$exitCode = 0
try {
if (-not (Test-Path $StartBat)) { throw "mikrotal-start.bat tidak ditemukan di $Root" }

# Mode boot & menghapus task butuh Administrator: minta izin lalu jalankan ulang skrip ini
$needAdmin = ($Mode -eq 'boot') -or ($Mode -eq 'remove' -and (Get-MikrotalTask))
if ($needAdmin -and -not (Test-Admin)) {
  Write-Host 'Meminta izin Administrator (klik Yes pada jendela yang muncul)...'
  try {
    $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Mode', $Mode, '-Elevated'
    )
    exit $p.ExitCode
  } catch {
    Write-Host 'Izin Administrator tidak diberikan. Tidak ada yang diubah.' -ForegroundColor Yellow
    exit 1
  }
}

switch ($Mode) {
  'login' {
    if (Get-MikrotalTask) {
      throw 'Autostart Task Scheduler (saat komputer hidup) sudah terpasang. Hapus dulu dengan hapus-autostart.bat agar MIKROTAL tidak jalan dua kali.'
    }
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
    $s.TargetPath = $StartBat
    $s.WorkingDirectory = $Root
    $s.WindowStyle = 7   # mulai dalam keadaan minimize
    $s.Description = 'Jalankan server MIKROTAL'
    $s.Save()
    Write-Host 'Selesai. MIKROTAL akan menyala setiap kali Anda login ke Windows.' -ForegroundColor Green
    Write-Host 'Jendela MIKROTAL muncul kecil di taskbar. Jangan ditutup, karena server ikut mati.'
  }
  'boot' {
    if (Test-Path $Shortcut) {
      Remove-Item $Shortcut -Force
      Write-Host 'Autostart saat login dihapus, diganti autostart saat komputer hidup.'
    }
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$StartBat`" /service`"" -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    # Tanpa batas waktu (bawaan Windows menghentikan task setelah 3 hari) dan tetap jalan memakai baterai
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
      -Description 'Server MIKROTAL (dipasang oleh scripts\windows\autostart.ps1)' -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host 'Selesai. MIKROTAL menyala setiap kali komputer hidup, walau belum ada yang login.' -ForegroundColor Green
    Write-Host 'MIKROTAL juga sudah dinyalakan sekarang di latar belakang (tanpa jendela).'
    Write-Host "Log server: $(Join-Path $Root 'logs\mikrotal.log')"
    Write-Host 'Pastikan Node.js dipasang untuk semua pengguna (installer resmi nodejs.org), bukan lewat nvm.'
  }
  'remove' {
    $done = $false
    if (Test-Path $Shortcut) { Remove-Item $Shortcut -Force; $done = $true; Write-Host 'Autostart saat login dihapus.' }
    if (Get-MikrotalTask) {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      $done = $true
      Write-Host 'Autostart Task Scheduler dihapus.'
      Write-Host 'Bila server masih berjalan di latar belakang, ia berhenti setelah komputer dimatikan atau di-restart.'
    }
    if (-not $done) { Write-Host 'Tidak ada autostart MIKROTAL yang terpasang.' }
  }
}
Show-Status
} catch {
  Write-Host ''
  Write-Host "Gagal: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  if ($Elevated) { Write-Host ''; Read-Host 'Tekan Enter untuk menutup jendela ini' | Out-Null }
}
exit $exitCode
