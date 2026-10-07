# Gymli — rules for every session

Gymli is a membership and door-access system for **one** South African gym group
(Body Tone Gym, ~2,000 members per branch). Each **branch** has its own members, front desk,
DigitalPersona 4500 fingerprint reader and tripod turnstile.
There is a live pitch and then a 5-day trial at the gym. **A reliable, working product
matters more than extra features.** Do not add scope.

Read this file before you change anything. If a request conflicts with it, ask first.

---

## 1. Design is the source of truth (for appearance)

- `design/gymli-design.html` is the design reference (exported from Claude Design).
  **Read-only. Never modify, move, reformat or delete it.**
  SHA-256: `047701ed122f40a3272a0b224424899fba8b9648fb3972532a18395438e85096`.
  It is a self-unpacking bundle. Open it in a browser (or Playwright) to see the screens.
  Screens are marked with `data-screen-label`:
  `01 Today`, `02 Members`, `03 Member profile`, `04 Log payment`,
  `05a/b/c Check-in idle/welcome/denied`, `06a/b Enrol fingerprint/success`, `07 Mobile profile`.
- All design tokens (colours, gradients, radii, shadows, blur, spacing, type scale, fonts)
  live in **one tokens file** (CSS variables + Tailwind theme). Components use tokens only.
  **No hard-coded colours, sizes or one-off values in components.** If a value is missing,
  add a token. Do not add a value that is not in the design.
- Rebuild screens as reusable components that match the design closely: layout, spacing,
  radius, type, colour, icon style (Lucide icons, as in the design) and states
  (hover, focus, empty, loading, error).
- If something is not in the design (error states, login, Add member, Door log, settings),
  **extend the existing style**. Do not invent a new visual language.
- Copy tone: short, plain English, like the design ("Paid up", "Locked out",
  "Fingerprint not recognised", "Please see reception"). No jargon, no exclamation marks.
- Font: Archivo (Google Fonts, variable width). Headings use the condensed width
  (font-stretch ~66–68%) and heavy weight, as in the design.
- Light mode only for now.
- Visual check: Playwright screenshots of every built screen at **1440px and 390px**,
  compared side by side with the matching section of the design file. Fix differences before
  moving on. Record every deliberate deviation, and the reason, in `docs/design-deviations.md`.
- If the design and the requirements conflict: **requirements decide behaviour, the design
  decides appearance**. Tell the user about the conflict.

## 2. Scope

**In scope:** members (name, cellphone, member number `GY-1001…`, fingerprint enrolled yes/no,
SA ID or passport number — required for new members, date of birth (from the SA ID), email (optional),
emergency contact, staff notes); paid periods with **how they paid** (Cash, Card, EFT, Debit order)
and the **amount paid** (cents, pre-filled from a per-branch price list, editable, audited); access calendar per member; fingerprint enrolment and 1:N identification;
turnstile control; door log; staff logins (front desk, manager); audit trail;
**branches**: managers add branches and switch between them; front desk and check-in PCs belong to
one branch and only see it; a member belongs to one home branch (other branches turn them away).

**Accounts (managers only):** payments by date range and branch, totals by method, new vs renewals,
daily cash-up, branch comparison, renewals due, busiest hours; Excel and PDF exports. Front desk see
amounts on payments (their own today on Today, and on member payment lists), never Accounts.

**Out of scope — do not build:** running debit orders, invoicing/billing, refunds, bookings/classes,
reminders, member app, address, medical information.

**Personal details** live in `members/{id}/private/details` (staff) and the full ID number in
`members/{id}/private/identity` (managers only). The check-in PC never reads either. Front desk sees
the ID masked (last 3 characters) and cannot change an ID that is on file. Never put an ID number in
the audit trail or logs.

## 3. Business rules (each one has unit tests — keep them passing)

1. A paid period has a **start date and an end date, both inclusive**. Dates are calendar
   dates (no time) in **Africa/Johannesburg**.
2. Period options: day pass, 1, 3, 6, 12 months, or custom (N days or N months).
   - N days from S → ends S + N − 1 days. Day pass = 1 day (ends on S).
   - N months from S → ends (S + N months, day clamped to month end) − 1 day.
     - 1 month from 1 Oct → 1 Oct–31 Oct.
     - 1 month from 15 Oct → 15 Oct–14 Nov.
     - 1 month from 31 Jan → ends 27 Feb (28 Feb in a leap year: 31 Jan + 1 month clamps
       to 28/29 Feb, minus one day). Tests cover leap and non-leap years.
3. Default start date: if the member has access today, the day after their current
   "paid until" date (back-to-back periods join up); otherwise today. Staff can change it.
4. A member may enter if **today (Africa/Johannesburg)** is inside any paid period.
5. **No grace period.** Access ends at 23:59:59 on the end date.
6. Overlapping and future periods are allowed. "Paid until" = the end of the continuous
   run of periods (overlapping or back-to-back) that covers today.
7. Denied reasons, exactly:
   - `Fingerprint not recognised`
   - `Membership ended <date>` (end of the most recent period that ended)
   - `Paid period starts <date>` (member has only future periods; earliest future start)
   - `No paid membership` (member has never had a period)
8. Only a **manager** can edit or delete a payment. Every create, edit and delete is kept in
   the audit log (who, when, before, after). Deleted payments are soft-deleted.
9. Turnstile: on ALLOWED send one relay pulse (configurable, ~500 ms) = one entry.
   On DENIED: no pulse. No screen for members by default (`"Display": "background"`); with
   `"Display": "kiosk"` the result shows ~4 s, then back to idle.

Access rules run in two places (web app in TypeScript, check-in app in C#). Both run the
same shared test cases in `shared/test-vectors/`. Change the vectors first, then both
implementations.

## 4. Fingerprints and personal information (POPIA)

- Fingerprint templates are biometric personal information.
- Never store or send raw fingerprint images. Store templates (FMD) only.
- Encrypt templates at rest (cloud DB and local SQLite) and in transit (HTTPS only).
- Deleting a member deletes their templates everywhere, including on the check-in PC.
- Do not log template bytes, full cellphone numbers or other personal data in error logs.

## 5. Hardware

- The reader and relay sit behind interfaces `IFingerprintReader` and `ITurnstileRelay`.
- Simulation mode (default until hardware arrives): pick a member to "scan"; relay pulses
  are shown on screen. Real implementations are chosen by a config flag.
- The check-in app keeps working offline from its local SQLite copy and queues door logs.

## 6. Architecture (as built)

- **Backend: Firebase** (project `fundanii-ai`, Firestore database **`gymli-admin`** in africa-south1): Firebase Auth
  (email/password) + Cloud Firestore. The emulator uses the `(default)` database (`VITE_FIREBASE_DATABASE_ID`, `GYMLI_DATABASE_ID`).
  Web app hosted on Netlify (`netlify.toml`, https://gymli-admin.netlify.app).
  No server code. `firestore.rules` is the server-side guard — every protection lives there and is
  tested in `apps/web/tests/rules`. Change rules → run `npm run test:rules`.
- **Web app** `apps/web`: React + Vite + TypeScript + Tailwind v4. Tokens: `src/styles/tokens.css`
  (spacing base is 1px, so `p-22` = 22px). Business rules: `src/lib/access.ts`, `src/lib/dates.ts`.
  All writes go through `src/data/actions.ts` (transaction + audit entry). Live data: `src/data/store.tsx`.
- **Check-in app** `apps/checkin`: .NET 8. `Gymli.Checkin.Core` (rules, SQLite store, encrypted
  templates, Firestore REST sync, engine), hardware projects behind `IFingerprintReader`/`ITurnstileRelay`,
  `Gymli.Checkin.App` (Avalonia kiosk; `Tokens.axaml` mirrors the web tokens).
- Fingerprint enrolment is started in the web app (`enrolRequests` collection) and done by the check-in PC.
- Firestore data: `branches`, `members` (with `periods` array, soft-deleted payments), `templates` (ciphertext only),
  `doorLogs` (written by the PC only), `devices` (heartbeat), `enrolRequests`, `staff`, `audit` (add-only),
  `counters/members` (one GY-number sequence across branches), `config/bootstrap`.
- Money: `period.amountCents`, `branches/{id}.prices` (`day`, `m1`, `m3`, `m6`, `m12` in cents). Reports are
  pure functions in `src/lib/accounts.ts` (unit-tested); exports in `src/lib/export.ts` (exceljs, jspdf, lazy-loaded).
- Branches: one database; every branch-owned doc (`members`, `doorLogs`, `devices`, `enrolRequests`) has
  `branchId`, and `staff.branchId` (null for managers = all branches). `firestore.rules` enforces it
  (front desk queries must filter on `branchId`). The check-in PC reads its branch from its own `staff` doc
  and only syncs that branch. Current branch in the web app: `useGym().branch` (`src/lib/branch.ts`).

### Commands
| | |
|---|---|
| Emulator + sample data | `cd apps/web && npm run emulators` then `npm run seed` |
| Web app on the emulator | `npm run dev:emu` (logins in `scripts/seed.ts`) |
| Tests | `npm test`, `npm run test:rules`, `cd apps/checkin && dotnet test`, `npm run e2e` |
| Visual check | `npm run visual` (web) · `dotnet run --project apps/checkin/src/Gymli.Checkin.App -- --screenshots DIR` (kiosk) |
| Deploy | `docs/deployment.md` |

## 7. How to work

- Work milestone by milestone. Commit after each meaningful step with a clear message.
- After each milestone: run all tests, run the Playwright visual comparison, then give the
  user a short summary: done, next, and anything needed from them.
- **Ask before adding any dependency that costs money or needs an external account.**
- Prefer boring, well-known tools. Reliability first.
