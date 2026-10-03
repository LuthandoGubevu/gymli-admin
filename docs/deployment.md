# Deploying Gymli

Gymli has two parts:

- **Web app** (staff, any browser) — static site on **Firebase Hosting**, data in **Cloud Firestore**, logins with **Firebase Auth**. No server of our own.
- **Gymli Check-in** (reception PC, Windows 10/11) — runs in the background (no screen for members; they just scan their finger). Optional full-screen check-in screen: `"Display": "kiosk"`. Talks to Firestore with its own check-in login. Keeps a local copy, so the turnstile works without internet.

Security is enforced by `firestore.rules` (roles, front desk can only add payments, every member change needs an audit entry, templates readable only by the check-in PC). Tests: `npm run test:rules`.

## 1. Firebase project (once)

Project in this repo: `fundanii-ai` (`.firebaserc`). To use a new project, change `.firebaserc`, and set `VITE_FIREBASE_*` in `apps/web/.env.production` and `FirebaseApiKey/FirebaseProjectId` in the check-in `appsettings.json`.

In the [Firebase console](https://console.firebase.google.com):
1. **Build → Firestore Database → Create database**. Database ID: **`gymli-admin`** (the code, `firebase.json` and the check-in settings use this name). Location: `africa-south1` (Johannesburg) — keeps member data in South Africa (POPIA). The location cannot be changed later.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. Leave "Enable create (sign-up)" on: managers create logins from Settings with it. A login on its own gives no access — the rules only let in people a manager added as staff.
4. Plan: Spark (free) is enough for the trial (≈ 35k reads and ≈ 7k writes a day with one turnstile). For ~2,000 members long-term, use Blaze (pay as you go, expected well under R50/month) and set a budget alert.

### API key restrictions (Google Cloud console → APIs & Services → Credentials)

The Firebase web key is public by design, so restrict what it can be used for:

- **Web key** (the one in the web config): API restrictions = **Identity Toolkit API, Token Service API, Cloud Firestore API** only.
  After `npm run bootstrap` has run, optionally add Website restrictions: `https://<project>.web.app/*`, `https://<project>.firebaseapp.com/*`.
- **Check-in PC key** (optional second key, kept only in `C:\ProgramData\Gymli\appsettings.json`): Identity Toolkit API and Token Service API only; IP restriction if the gym has a fixed IP.
- No key may be left with "None" under API restrictions, and Gymli never needs the Gemini / Firebase AI Logic APIs.

## 2. Deploy the web app and rules

```bash
npm install -g firebase-tools        # once
firebase login                        # once, with the Google account that owns the project
cd apps/web && npm ci
npm run deploy                        # builds, then deploys hosting + firestore rules + indexes
```
The site is at `https://<project>.web.app`. Wait ~5 minutes for indexes to build the first time.

## 3. First manager

```bash
cd apps/web
npm run bootstrap -- "Grace Venter" grace@yourgym.co.za 'a-strong-password'
```
Works once. Grace then signs in and adds staff in **Settings → Staff logins**.

## 4. Check-in login

Signed in as a manager: **Settings → Check-in PCs → Add check-in login**. Copy the email and password shown (shown once).

## 5. Reception PC

Build (any computer with the .NET 8 SDK):
```bash
apps/checkin/scripts/publish.sh      # → apps/checkin/dist/GymliCheckin
```
On the reception PC (Windows 10/11, its own local user that signs in automatically):
1. Install the **HID DigitalPersona U.are.U runtime/SDK** (gives `dpfpdd.dll`, `dpfj.dll`) and plug in the 4500 reader.
2. Plug in the USB relay (CH340 "LCUS" type). Note its COM port in Device Manager.
3. Copy `GymliCheckin` to the PC, open PowerShell **as Administrator** in that folder: `./install.ps1`
4. Edit `C:\ProgramData\Gymli\appsettings.json`:
   ```json
   { "Mode": "hardware", "DeviceEmail": "turnstile1@…", "DevicePassword": "…", "RelayPort": "COM3", "RelayPulseMs": 500 }
   ```
5. **Back up the fingerprint key** (needed to move to a new PC without re-enrolling everyone):
   `"C:\Program Files\Gymli\Checkin\Gymli.Checkin.exe" --export-key` → store in the manager's password manager.
   On a replacement PC: `Gymli.Checkin.exe --import-key <key>` before first start.
6. Restart. Gymli Check-in starts minimised in the taskbar (the X button only minimises it). **Ctrl+Shift+Q** closes it (staff). Logs: `C:\ProgramData\Gymli\logs`.

Updating: run `publish.sh`, copy the folder, run `install.ps1` again (settings, data and key are kept).

## Turnstile wiring

Relay **COM + NO** → turnstile controller **entry / "open A"** dry-contact input (check the controller manual; most tripod controllers take a momentary closure). One pulse = one entry. Do not wire to the motor/solenoid directly. Exit stays free as the turnstile is set up today.

## Local development

```bash
cd apps/web
npm run emulators            # terminal 1 (Firebase emulator, no real data)
npm run seed                 # 30 sample members, logins: zodwa@gymli.co.za / gymli-demo-2026
npm run dev:emu              # terminal 2 → http://localhost:5173
cd ../checkin
GYMLI_EMULATOR_HOST=127.0.0.1 GYMLI_PROJECT_ID=demo-gymli GYMLI_API_KEY=demo-key \
GYMLI_DEVICE_EMAIL=turnstile1@gymli.local GYMLI_DEVICE_PASSWORD=gymli-demo-2026 \
dotnet run --project src/Gymli.Checkin.App        # kiosk in simulation mode (F2: panel)
```

Tests:

| What | Command |
|---|---|
| Business rules, CSV, helpers (web) | `cd apps/web && npm test` |
| Security rules | `npm run test:rules` (starts its own emulator) |
| Check-in app (rules vectors, engine, store, sync vs emulator) | `cd apps/checkin && dotnet test` |
| Acceptance test (all 5 steps, browser + kiosk) | emulator + seed + `npm run dev:emu`, then `npm run e2e` |
| Visual check vs design | same setup, then `npm run visual` → `tests/visual/output/report.html` |
