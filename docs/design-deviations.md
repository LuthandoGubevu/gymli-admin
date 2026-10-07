# Design deviations

Everything here is a deliberate difference from `design/gymli-design.html`, with the reason.
Checked with `npm run visual` (web, 1440 and 390) and `Gymli.Checkin --screenshots` (kiosk).

| Where | Design | Built | Why |
|---|---|---|---|
| Top nav + rail | 3 items: Today, Members, Check-in screen | Today, Members, **Door log** (scroll icon) | The brief requires a Door log screen; the design has none. Check-in screen removed (see below). Same pill/rail style. |
| Rail | Settings icon for everyone | Settings shown to **managers only** | Only managers manage staff, import and audit. |
| Top nav search | Empty grey circle | Search icon; opens Members with the search box focused | Design shows an unlabelled circle; a search icon makes its job clear. |
| "Check-in screen" (05a–c) | Kiosk is shown as a screen of the product | No check-in screen by default: members only scan their finger. The web page is removed; turnstile status (online, reader, relay) is in Settings → Check-in PCs and the header chip; scans are on Today and Door log. The kiosk screens stay available with `"Display": "kiosk"`. | Gym's decision (Oct 2026): no screen at the turnstile. |
| Log payment → "Logged by" | Dropdown with chevron | Fixed to the signed-in person, no chevron | Audit trail: a payment is always logged by whoever is signed in. |
| Log payment → Custom | Only the "— Custom" tile is shown | Selecting it shows a Days/Months switch and a −/+ stepper below the grid | The design says "custom stepper works" but does not draw it; built from the existing segmented-pill and field styles. |
| Log payment (manager editing) | — | Same modal, title "Change payment for", plus **Delete payment** | Managers can edit/delete payments (brief). |
| Enrol fingerprint | "Capture scan" captures directly | Each press asks the check-in PC for one scan; shows "Check-in PC offline" when it is off | The reader is plugged into the reception PC, not the browser. |
| Member profile | Fingerprint card always "Right index finger · Re-enrol" | "No fingerprint yet · Enrol" when not enrolled | State not in the design. |
| Access card | Green "Can enter" only (desktop), red "Locked out" (mobile) | Also yellow "Not yet · starts …" and red "No payment yet · never paid" | States not in the design; built from the same card. |
| Paid periods | "Current" pill | Also grey "Next" for future periods, pencil for managers | States not in the design. |
| Members filters | Locked out = 7 | "Locked out" counts only members whose last period ended; members who never paid or start later appear under All | Matches the design's numbers (16 + 6 + 7 + 1 = 30). |
| Login, Add member, Door log, Settings | Not designed | Built from modal, field, pill and card styles | Brief: extend the existing style. |
| Arrows "8 Sep → 7 Oct" | Thin arrow (fallback font in the design file) | Archivo's own arrow, a little heavier | The bundled Archivo has the arrow glyph. |
| Kiosk fonts | Archivo variable width (CSS font-stretch) | Archivo instances pinned at 62/64/66/68 % width (`Assets/Fonts`) | The kiosk UI toolkit cannot set the width axis; the pinned instances render the same shapes. |
| Kiosk | — | Enrolment view on the kiosk (ring + "Scan 2 of 4") | The member at the reader needs to see what to do. Reuses the idle orb and the enrol dots. |
| Ending soon colour | Dashboard: "Yellow = 3 days or less"; Members list: "Ends in 6 days" also yellow | Status "Ending this week" (0–6 days) is yellow everywhere; on Today, cards with ≤ 3 days are filled yellow | Reads both parts of the design consistently. |
| Add member / Edit details | Name + cellphone only | ID number (SA ID / Passport switch, live check), date of birth (filled in from the SA ID), email, emergency contact, notes | Requested after the pitch planning; mockup `docs/mockup-member-fields.png`. Same modal, field and segmented-pill styles. |
| Log payment | How long, start date | **Paid by** row (Cash, Card, EFT, Debit order) under How long, same tile style | Payment method requested (method only, no amounts). |
| Member profile | No details card | **Details** card under the fingerprint card: ID (masked; managers can Show), date of birth, email, emergency contact, notes | Shows the new fields; "ID number missing" pill when none is on file. |
| Branch switcher (header) | — | Glass pill after the section nav with the branch name; managers get a menu to switch branches (check mark on the current one) and "Manage branches"; front desk sees their branch as plain text | Branches requested (Oct 2026). Same pill, menu and row styles as the turnstile chip and user menu. |
| Settings | Staff logins, check-in PCs | **Branches** card (add, rename) above; branch picker (pill group) in Add staff / Add check-in login; staff rows show their branch; check-in PCs and CSV import are for the current branch | Same card, row and segmented-pill styles. |
| First sign-in after branches | — | "Name your first branch" screen (page header + card with one field) | Existing data is moved into the first branch. |
