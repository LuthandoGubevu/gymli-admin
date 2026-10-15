# On-site hardware test (existing reader and gate)

Goal: prove Gymli works with the gym's **own** fingerprint reader and gate box, without changing any
wiring and without disturbing the current system (Itensity). Everything here can be undone by
closing Gymli and starting Itensity again. About 1 hour; do it at a quiet time.

What we know: HID DigitalPersona reader on the counter (USB to the reception PC); a black gate
box in the cabinet, USB to the PC, two thin wires to the gate. Itensity's app drives both today.

## Before the day
- [ ] Copy the **GymliCheckin** folder (from `GymliCheckin-win-x64.zip`) onto a USB stick.
- [ ] Web app, signed in as manager, correct branch chosen: **Settings → Check-in PCs → Add check-in login**.
      Write down the email and password (shown once).
- [ ] Agree with the gym that Itensity's app may be closed for up to an hour, and how to start it again.
- [ ] Optional backup: a Windows 10/11 laptop. Moving the reader's and gate box's USB plugs to the laptop
      leaves the gym PC untouched (the laptop needs the DigitalPersona runtime, see below).

## A. Photos and facts (10 min)
- [ ] Gate box: close-ups of every side, any sticker, model name, text next to the green terminals.
- [ ] Sticker under the fingerprint reader.
- [ ] Windows version: Settings → System → About (edition, version, 64-bit).

## B. Hardware test (20 min) — nothing is saved or sent
1. Close Itensity's app completely (also its icon next to the clock; check Task Manager).
2. Copy the GymliCheckin folder to the desktop. Double-click **Hardware test.bat**.
   If Windows says "Windows protected your PC": **More info → Run anyway**.
3. Follow the questions on screen:
   - **Fingerprint software**: are `dpfpdd.dll` and `dpfj.dll` on the PC?
   - **Reader**: scan one finger 4 times → template; same finger → recognised; another finger → not recognised;
     plus the time to search 2,000 members.
   - **USB devices**: the list tells us what the gate box is.
   - **Gate**: one 0.5 s pulse per possible relay; answer whether the gate clicked or unlocked.
4. The report is saved on the desktop (`gymli-hardware-test-….txt`). Send it to Apex Dev Studios.

## C. Live test (30 min) — only if the reader and the gate passed in B
1. In the GymliCheckin folder, edit `appsettings.json`:
   `"Mode": "hardware"`, `"DeviceEmail"` / `"DevicePassword"` from the check-in login,
   and the relay line the hardware test printed (for example `"RelayType": "hid"`).
   Do **not** run `install.ps1` (that makes it start with Windows).
2. Double-click **Gymli.Checkin.exe**. It starts in the taskbar.
3. Web app → Settings → Check-in PCs: **online**, reader ✓, relay ✓.
4. Add a test member (yourself) → **Enrol fingerprint** (4 scans at the reader) → **Log payment** (day pass).
5. Scan → the gate opens once. Scan a finger that is not enrolled → the gate stays locked.
6. Web app → **Door log**: both scans are there, "Let in" and "Fingerprint not recognised".

## D. Put everything back
- [ ] Close Gymli: open it from the taskbar and press **Ctrl+Shift+Q**.
- [ ] Start Itensity's app again (or restart the PC) and check that a member can still get in.
- [ ] Optional: remove the test member (manager) — this deletes the test fingerprint.

## What the results mean
| Result | Next step |
|---|---|
| `dpfpdd.dll` / `dpfj.dll` not found | The PC needs HID's DigitalPersona U.are.U runtime. It comes with HID's U.are.U SDK, which is licensed — a cost decision before the trial. |
| Reader ✓, gate box did not react to any pulse | The box uses Itensity's own protocol. Fit a 1-channel USB relay board (CH340 "LCUS" or HID "USBRelay", about R150–R300) to the same two gate wires. |
| Reader ✓, gate ✓ | Ready for the trial: the existing reader and gate box work as they are. |
| Gate opens but the reader fails the match test | Repeat with a clean, dry finger; send the report — the reader code is being checked on real hardware for the first time. |
