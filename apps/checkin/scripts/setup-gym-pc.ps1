<#
  Gymli Check-in — guided set-up of the gym's reception PC (started by "3 Set up this PC.bat").

  1. Checks the ZKTeco driver is installed
  2. Asks for the check-in login (made in the web app: Settings → Check-in PCs → Add check-in login)
  3. Writes C:\ProgramData\Gymli\appsettings.json (hardware mode, ZKTeco reader)
  4. Runs install.ps1 (starts with Windows, hidden, watchdog, PC kept awake)
  5. Waits for Gymli to come online and shows the result
  6. Shows the fingerprint key to back up
#>
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
# Any unexpected error: show it and keep the window open, so it can be read and sent to Apex Dev Studios.
trap { Write-Host "Something went wrong: $_" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
$src = $PSScriptRoot
$data = 'C:\ProgramData\Gymli'
$settingsPath = Join-Path $data 'appsettings.json'

function Step($text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }
function Fail($text) { Write-Host $text -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

Write-Host 'Body Tone Gym · Gymli Check-in set-up' -ForegroundColor White
Write-Host '======================================'

Step '1. ZKTeco fingerprint driver'
if (-not (Test-Path 'C:\Windows\System32\libzkfp.dll') -and -not (Test-Path (Join-Path $src 'libzkfp.dll'))) {
  Fail 'Not installed. Run setup.exe from the "1 Drivers" folder first (ZKFinger SDK), then run this again.'
}
Write-Host 'OK: libzkfp.dll found'

Step '2. Check-in login (from the web app: Settings → Check-in PCs → Add check-in login)'
$email = (Read-Host 'Check-in email').Trim()
if ($email -notmatch '@') { Fail 'That is not an email address. Run this again.' }
$secure = Read-Host 'Check-in password' -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ([string]::IsNullOrWhiteSpace($password)) { Fail 'No password entered. Run this again.' }
$name = (Read-Host 'Name for this PC [Reception PC]').Trim()
if ($name -eq '') { $name = 'Reception PC' }

Step '3. Settings'
# Start from an existing settings file (keeps relay and other choices), else from the one in this folder.
$base = if (Test-Path $settingsPath) { $settingsPath } else { Join-Path $src 'appsettings.json' }
$s = Get-Content $base -Raw | ConvertFrom-Json
function SetField($obj, $key, $value) {
  if ($obj.PSObject.Properties[$key]) { $obj.$key = $value } else { $obj | Add-Member -NotePropertyName $key -NotePropertyValue $value }
}
SetField $s 'Mode' 'hardware'
SetField $s 'Reader' 'zkteco'
SetField $s 'DeviceName' $name
SetField $s 'DeviceEmail' $email
SetField $s 'DevicePassword' $password
New-Item -ItemType Directory -Force -Path $data | Out-Null
# Written as UTF-8 without a BOM
[IO.File]::WriteAllText($settingsPath, ($s | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
$password = $null
Write-Host "Saved $settingsPath (hardware mode, ZKTeco reader, $email)"

Step '4. Install (starts with Windows, hidden, watchdog)'
& (Join-Path $src 'install.ps1')

Step '5. Waiting for Gymli to come online (up to 60 seconds)...'
$log = Join-Path $data ("logs\gymli-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
$started = Get-Date
$result = $null
while (((Get-Date) - $started).TotalSeconds -lt 60 -and -not $result) {
  Start-Sleep -Seconds 3
  if (Test-Path $log) {
    $recent = Get-Content $log -Tail 40 | Where-Object { $_ -match '^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d' -and [datetime]::ParseExact($_.Substring(0, 19), 'yyyy-MM-dd HH:mm:ss', $null) -ge $started.AddSeconds(-2) }
    if ($recent -match 'Back online') { $result = 'online' }
    elseif ($recent -match 'login refused|Sync failed') { $result = 'failed' }
  }
}
if (Test-Path $log) { Get-Content $log -Tail 8 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
if ($result -eq 'online') { Write-Host 'ONLINE. The web app (Settings → Check-in PCs) should now show this PC.' -ForegroundColor Green }
elseif ($result -eq 'failed') { Write-Host 'NOT ONLINE: see the log lines above. A wrong email or password? Run this again with the right one.' -ForegroundColor Red }
else { Write-Host 'No answer yet. Check the internet connection, then look at Settings → Check-in PCs in the web app.' -ForegroundColor Yellow }

Step '6. Fingerprint key: back it up NOW'
Write-Host 'Without this key, a replacement PC cannot read the enrolled fingerprints (everyone would re-enrol).'
Write-Host 'Store it in the manager''s password manager. Do not email it or leave it on this PC.'
# Gymli.Checkin.exe is a window app: wait for it, and let it print into this window.
Start-Process -FilePath 'C:\Program Files\Gymli\Checkin\Gymli.Checkin.exe' -ArgumentList '--export-key' -Wait -NoNewWindow

Write-Host ''
Write-Host 'Done. Restart the PC once and check the Gymli icon next to the clock (click ^ to see hidden icons).' -ForegroundColor Green
Read-Host 'Press Enter to close'
