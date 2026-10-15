<#
  Gymli Check-in — install on the reception PC (run in PowerShell as Administrator from the published folder).

  What it does:
   1. Copies the app to C:\Program Files\Gymli\Checkin
   2. Creates C:\ProgramData\Gymli\appsettings.json (keeps an existing one)
   3. Starts Gymli Check-in at logon, hidden (icon next to the clock), and a watchdog that
      starts it again within 5 seconds if it is ever closed or crashes (Task Scheduler)
   4. Stops Windows from sleeping or turning the screen off

  Then: edit C:\ProgramData\Gymli\appsettings.json (DeviceEmail, DevicePassword, Mode) and restart the PC.
#>
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dest = 'C:\Program Files\Gymli\Checkin'
$data = 'C:\ProgramData\Gymli'

Write-Host 'Stopping any running kiosk...'
Stop-ScheduledTask -TaskName 'Gymli Check-in watchdog' -ErrorAction SilentlyContinue
Get-Process -Name 'Gymli.Checkin' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Write-Host "Copying to $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force

New-Item -ItemType Directory -Force -Path $data | Out-Null
$settings = Join-Path $data 'appsettings.json'
if (-not (Test-Path $settings)) {
  Copy-Item (Join-Path $src 'appsettings.json') $settings
  Write-Host "Created $settings — fill in DeviceEmail and DevicePassword."
} else {
  Write-Host "Kept existing $settings"
}
# The kiosk (normal user) writes its database and logs here; only Administrators may change the settings
icacls $data /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Users:(OI)(CI)M" | Out-Null
icacls $settings /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" "Users:R" | Out-Null

Write-Host 'Registering auto-start (Task Scheduler: at logon, restart on failure)...'
$exe = Join-Path $dest 'Gymli.Checkin.exe'
$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $dest
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settingsTask = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -GroupId 'BUILTIN\Users' -RunLevel Limited
Register-ScheduledTask -TaskName 'Gymli Check-in' -Action $action -Trigger $trigger -Settings $settingsTask -Principal $principal -Force | Out-Null

# Watchdog: a hidden loop that starts Gymli again within 5 seconds if it stops (closed or crashed).
# Also checked every 5 minutes, in case the watchdog itself was stopped (a second copy is never started).
$watch = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $dest 'watchdog.ps1')`"" -WorkingDirectory $dest
$watchTriggers = @((New-ScheduledTaskTrigger -AtLogOn), (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)))
$watchSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName 'Gymli Check-in watchdog' -Action $watch -Trigger $watchTriggers -Principal $principal -Settings $watchSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'Gymli Check-in watchdog'

Write-Host 'Keeping the PC awake...'
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Write-Host ''
Write-Host 'Done. Next:'
Write-Host "  1. Edit $settings (Mode, DeviceEmail, DevicePassword, RelayPort)"
Write-Host "  2. Back up the fingerprint key:  & '$exe' --export-key   (store it in the manager's password manager)"
Write-Host '  3. Restart the PC. Gymli runs hidden: hover the icon next to the clock for its status, click it to open.'
Write-Host '     Maintenance: disable the "Gymli Check-in watchdog" task first, otherwise Gymli restarts within 5 seconds.'
