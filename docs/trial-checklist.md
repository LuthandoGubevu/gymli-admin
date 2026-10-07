# Trial setup checklist (one page)

**Before the day**
- [ ] Firebase project ready: Firestore in `africa-south1`, Email/Password on ([deployment.md](deployment.md) §1)
- [ ] `npm run deploy` done; web app opens at `https://<project>.web.app`
- [ ] First manager created; front-desk logins made for every staff member on the trial
- [ ] Branches named (first sign-in as manager, then Settings → Branches); front desk logins each in their branch
- [ ] Check-in login made per branch (Settings → Check-in PCs, branch chosen); email + password written down for that PC
- [ ] Gym's member list exported as CSV (name, cellphone, paid until) and imported (Settings → Import members); spot-check 5 members
- [ ] Spare: USB relay, USB extension for the reader, printed copy of this page

**At the gym — reception PC**
- [ ] Windows user that signs in automatically; Windows Update set to outside opening hours
- [ ] DigitalPersona runtime installed; reader plugged in (blue light)
- [ ] USB relay plugged in; COM port noted
- [ ] `install.ps1` run; `appsettings.json`: `"Mode": "hardware"`, check-in email/password, `RelayPort`
- [ ] `--export-key` done and key stored by the manager
- [ ] Restart → Gymli Check-in starts minimised in the taskbar; open it, pill says **Online · synced**

**Turnstile**
- [ ] Power off; relay COM/NO → controller entry input; power on
- [ ] Web app → Settings → Check-in PCs: reader ✓, relay ✓, online ✓

**Acceptance test (do all five, tick each)**
1. [ ] Add a test member → Enrol (4 scans) → Log 1 month → scan → **WELCOME** and the arm turns once
2. [ ] (Optional on site: done in simulation) Clock past the end date → **DENIED "Membership ended …"**, arm stays locked
3. [ ] Log 3 months → scan within seconds → **WELCOME**
4. [ ] Pull the network cable → pill turns yellow **Offline · using saved list** → scan still works → plug back in → scan appears in **Door log** marked "while offline"
5. [ ] Unknown finger → **DENIED "Fingerprint not recognised"**
- [ ] Remove the test member (manager) — erases the fingerprint everywhere

**During the 5 days**
- [ ] Each morning: Today screen opens; turnstile chip says online; no "scans waiting to upload"
- [ ] Problems → note the time; logs are in `C:\ProgramData\Gymli\logs`
- [ ] If the PC fails: the turnstile's manual key / free-entry switch is the fallback (agree this with the gym first)
