<#
  Gymli Check-in watchdog: keeps the check-in program running on the reception PC.
  If it is closed (Task Manager, Ctrl+Shift+Q) or crashes, it is started again within 5 seconds.
  Started by Task Scheduler ("Gymli Check-in watchdog") at logon. To stop Gymli for maintenance,
  disable that task first.
#>
$exe = Join-Path $PSScriptRoot 'Gymli.Checkin.exe'
while ($true) {
  if (-not (Get-Process -Name 'Gymli.Checkin' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $exe -WorkingDirectory $PSScriptRoot
  }
  Start-Sleep -Seconds 5
}
