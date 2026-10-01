# Gymli

Membership and door access for one gym: members, paid periods, fingerprint check-in at the turnstile, door log, staff logins and an audit trail.

- `apps/web` — staff web app (React + Vite + Tailwind, Firebase Auth + Firestore)
- `apps/checkin` — Gymli Check-in, the Windows kiosk at the turnstile (.NET 8 + Avalonia; DigitalPersona 4500 + USB relay, or simulation)
- `shared/test-vectors` — business-rule cases run by both apps
- `firestore.rules` — the server-side guard
- `design/gymli-design.html` — the design (read-only)
- `docs/` — [deployment](docs/deployment.md), [trial checklist](docs/trial-checklist.md), [design deviations](docs/design-deviations.md)

Rules for working on this repo are in [CLAUDE.md](CLAUDE.md).
