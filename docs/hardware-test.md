# On-site hardware test (existing reader and gate)

Goal: prove Gymli works with the gym's **own** fingerprint reader and gate box, without changing any
wiring and without touching the gym's PC: the reader and the gate box are moved to a laptop running
Gymli for about an hour, then plugged back. Do it at a quiet time.

What we know: a black gate box in the cabinet, USB to the PC, two thin wires to the gate. Itensity's app
drives it today. Itensity's HID DigitalPersona reader needs HID's paid runtime, so Gymli uses its own
**ZKTeco ZK9500** reader (free ZKFinger SDK) on the counter instead.

## Before the day (on your laptop, at home)
- [ ] Laptop: Windows 10 or 11, 64-bit, charged, with internet on site (gym Wi-Fi or a phone hotspot).
- [ ] Put the **GymliCheckin** folder (from `GymliCheckin-win-x64.zip`) on the laptop's desktop.
- [ ] Double-click **Hardware test.bat** once, with nothing plugged in. It must open and finish; look at step 2:
      - `libzkfp.dll` **found** → the ZK9500 reader test will run.
      - **not found** → run `setup.exe` from ZKTeco's ZKFinger SDK (Fingerprint Reader Standard Driver) and try again.
        If it says only the 32-bit version is installed, copy the x64 `libzkfp.dll` from the SDK's `c` folder
        into the GymliCheckin folder.
- [ ] Web app, signed in as manager, correct branch chosen: **Settings → Check-in PCs → Add check-in login**.
      Write down the email and password (shown once).
- [ ] Agree a quiet time with the gym: while the two USB plugs are in your laptop, Itensity cannot open the gate,
      so staff let members through by hand for that hour.

## On site: move the two USB plugs to the laptop
- [ ] Note which USB ports on the gym PC the **reader** and the **gate box** use (photo).
- [ ] Put the laptop next to the gym PC (the cables are only long enough to reach there).
- [ ] Unplug both from the gym PC and plug them into the laptop. Leave the gym PC and Itensity as they are.
- [ ] Wait a minute for Windows to set up the devices (the gate box may need its USB driver from Windows Update;
      the hardware test lists it either way).

## A. Photos and facts (10 min)
- [ ] Gate box: close-ups of every side, any sticker, model name, text next to the green terminals.
- [ ] Sticker under the fingerprint reader.
- [ ] Windows version: Settings → System → About (edition, version, 64-bit).

## B. Hardware test (20 min) — nothing is saved or sent
1. On the laptop, double-click **Hardware test.bat** in the GymliCheckin folder.
2. (Nothing to close: Itensity stays on the gym PC.)
   If Windows says "Windows protected your PC": **More info → Run anyway**.
3. Follow the questions on screen:
   - **Fingerprint software**: is `libzkfp.dll` (ZKTeco) on the PC? (It also checks for HID's `dpfpdd.dll` / `dpfj.dll`.)
   - **Reader**: scan one finger 4 times → template; same finger → recognised; another finger → not recognised;
     plus the time to search 2,000 members.
   - **USB devices**: the list tells us what the gate box is.
   - **Gate**: one 0.5 s pulse per possible relay; answer whether the gate clicked or unlocked.
4. The report is saved on the desktop (`gymli-hardware-test-….txt`). Send it to Apex Dev Studios.

## C. Live test (30 min) — only if the reader and the gate passed in B
1. In the GymliCheckin folder, edit `appsettings.json`:
   `"Mode": "hardware"`, `"Reader": "zkteco"`, `"DeviceEmail"` / `"DevicePassword"` from the check-in login,
   and the relay line the hardware test printed (for example `"RelayType": "hid"`).
   Do **not** run `install.ps1` (that makes it start with Windows).
2. Double-click **Gymli.Checkin.exe**. It runs hidden: its icon appears next to the clock (hover for status, click to open).
3. Web app → Settings → Check-in PCs: **online**, reader ✓, relay ✓.
4. Add a test member (yourself) → **Enrol fingerprint** (4 scans at the reader) → **Log payment** (day pass).
5. Scan → the gate opens once. Scan a finger that is not enrolled → the gate stays locked.
6. Web app → **Door log**: both scans are there, "Let in" and "Fingerprint not recognised".

## D. Put everything back
- [ ] Close Gymli: click its icon next to the clock, then press **Ctrl+Shift+Q** in the window that opens.
      (No watchdog runs in this test, because `install.ps1` was not used, so it stays closed.)
- [ ] Plug the reader and the gate box back into the **same USB ports** on the gym PC.
- [ ] If Itensity does not find them, restart Itensity's app (or the gym PC). Check that a member can get in.
- [ ] Optional: remove the test member (manager) — this deletes the test fingerprint.

## What the results mean
| Result | Next step |
|---|---|
| `libzkfp.dll` not found | Run the ZKFinger SDK `setup.exe` (free), or copy the x64 `libzkfp.dll` next to Gymli.Checkin.exe. |
| "No reader found" with the driver installed | Check the ZK9500's USB cable and light; close any other fingerprint program; send the report. |
| Reader ✓, gate box did not react to any pulse | The box uses Itensity's own protocol. Fit a 1-channel USB relay board (CH340 "LCUS" or HID "USBRelay", about R150–R300) to the same two gate wires. |
| Reader ✓, gate ✓ | Ready for the trial: the existing reader and gate box work as they are. |
| Gate opens but the reader fails the match test | Repeat with a clean, dry finger; send the report — the reader code is being checked on real hardware for the first time. |
