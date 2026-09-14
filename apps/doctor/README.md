# MediBook — Doctor App

Expo Router app implementing the clinician half of the PRD: registration and verification,
the daily operating loop, schedule control, calendar integration, patient context and
professional profile (PRD §7.2, journeys J9–J13).

```bash
npm install                 # from the repository root
npm run doctor              # start the Expo dev server
```

Runs in **Expo Go** (SDK 57) with no network by default.

## The transport seam

`src/lib/api.ts` picks the implementation at bundle time, exactly like the patient app:

| `EXPO_PUBLIC_API_URL` | Implementation |
|---|---|
| unset (default) | `createMockApi()` — the bundled offline dataset |
| `http://localhost:4000/v1` | `createHttpApi()` — the Fastify service in `services/api` |

Screens import `doctorApi` and never branch on transport. To use the backend:

```bash
cp .env.example .env
echo 'EXPO_PUBLIC_API_URL=http://localhost:4000/v1' >> .env   # then restart the dev server
```

In offline mode you are signed in as **Dr. Arjun Mehta** (`doc_arjun`), whose weekly template
includes a short Sunday clinic so the Today timeline is populated whatever day you open it. Any
6-digit OTP works; `123456` is the documented demo code.

## Screen map

```
app/
├── _layout.tsx                       fonts · providers · session/verification gate · splash
├── (auth)/                           onboarding · phone · OTP · verification wizard
├── (tabs)/                           Today · Appointments · Schedule · Patients · Profile
├── appointment/[appointmentId]/      detail · reschedule · cancel · patient context
├── schedule/                         rules (weekly template) · exceptions · calendar · policy
├── profile/                          edit · fees · verification
└── settings/                         notifications · help · legal
```

## How the tabs map to the PRD

**Today (§7.2, J11)** — verified status header, quick stats (count, completed, cancellations,
pending approvals, next free slot) and the day's timeline in **clinic-local** time. A conflict
banner appears when an external calendar event overlaps a booked appointment, with a one-tap
route into the appointment.

**Appointments (DOC-010…DOC-014)** — Upcoming / Pending approval / Past. Actions are only
offered for states where the transition is legal: accept or decline a request; reschedule from
your own open slots; cancel with a mandatory reason (always a full refund to the patient);
mark completed; mark no-show once the grace period has actually elapsed.

**Schedule (DOC-005…DOC-009)** — the weekly template editor validates against overlapping
windows, exceptions show an **affected-bookings resolution list** so nothing is stranded,
calendar connections show per-account health with re-sync and disconnect, and the booking
policy screen edits min notice, window, approval mode, no-show grace and buffers.

**Patients (DOC-015)** — everyone you have seen, each linking to a context view scoped to visits
with *you*: name, age, gender, masked phone, booking note, visit history and no-show count.
Cross-doctor history is not present anywhere in the system.

**Profile (DOC-003/004/016)** — professional profile, fees and durations per consult type,
clinic address and timezone, verification status with the go-live checklist, notification
preferences, logout and the deactivation request (which resolves future appointments rather
than erasing them).

## Verification (J9/J10)

The wizard captures registration number, council, country, specialisations and documents
(licence required; government ID and degrees optional). Licence capture is a **filename-only**
simulation — no camera or file picker is bundled — and the screen says so.

Status handling covers every state the API can report: `pending`, `under_review`, `approved`,
`rejected` with a structured reason and resubmission path, and `suspended`. Until verification
is approved the app stays in setup mode; the server independently refuses to list or book an
unapproved doctor, so this is not a client-side gate.

## Scheduling integrity

- Weekly windows are stored as **clinic-local wall time** and expanded per date, so a 10:00
  clinic stays 10:00 across a daylight-saving change instead of drifting to 09:00.
- Editing a template or adding a leave **never touches existing bookings**. Overlaps surface as
  a resolution list where each appointment is rescheduled or cancelled deliberately.
- External calendar busy time hides unbooked slots automatically, but a busy event that
  collides with a booked appointment raises a conflict for you to resolve. It never auto-cancels
  a patient.
- The reschedule picker reads your own availability, excluding the appointment being moved, so
  the move can never collide with itself.

## Verification commands

```bash
npm run typecheck:doctor                                     # strict TS, exit 0
npx expo config --type public                                # resolves app config
npx expo export --platform ios --output-dir /tmp/doctor-export    # real Metro bundle
```

## Simulated in this build

Calendar OAuth and sync (no provider credentials — the consent screen and token exchange are
local, busy time is generated deterministically), video consults (join window and room token are
real; the call is a placeholder), document upload, and payment/refund execution. Each is labelled
in the UI rather than presented as live.
