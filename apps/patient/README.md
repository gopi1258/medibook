# MediBook — Patient App

Expo Router app implementing the patient half of the PRD: registration, discovery,
availability, booking with payment, and appointment management for the whole family
(PRD §7.1, journeys J1–J8).

```bash
npm install                 # from the repository root
npm run patient             # start the Expo dev server
```

Runs in **Expo Go** (SDK 57) with no network by default.

## The transport seam

The app talks to exactly one API object, chosen at bundle time in `src/lib/api.ts`:

| `EXPO_PUBLIC_API_URL` | Implementation |
|---|---|
| unset (default) | `createMockApi()` — the bundled offline dataset |
| `http://localhost:4000/v1` | `createHttpApi()` — the real Fastify service in `services/api` |

Screens import `patientApi` and never learn which one they got. To point the app at the backend:

```bash
cp .env.example .env
echo 'EXPO_PUBLIC_API_URL=http://localhost:4000/v1' >> .env   # then restart the dev server
```

In offline mode you are **Priya Sharma** with two dependents already on the account. Any
6-digit OTP signs you in; `123456` is the documented demo code.

## Screen map

```
app/
├── _layout.tsx                       fonts · SafeArea · QueryClient · session gate · splash
├── index.tsx                         branded splash while the gate decides
├── (auth)/                           onboarding · phone · OTP · profile setup
├── (tabs)/                           Home · Discover · Appointments · Alerts · Profile
├── doctor/[doctorId].tsx             full profile: verified badge, quals, fees, reviews, availability
├── slots/[doctorId].tsx              day strip + slot grid in your timezone, with freshness
├── booking/[doctorId].tsx            booking sheet + simulated payment (hold countdown lives here)
├── payment/[appointmentId].tsx       pay/retry for an existing appointment
├── confirmation/[appointmentId].tsx  appointment code, directions/join, receipt
├── appointment/[appointmentId]/      detail · reschedule · cancel · review
├── family/                           family members list + editor
└── settings/                         my details · notifications · saved doctors · help · legal
```

## The booking flow (J3) and what makes it honest

1. **Slot picker** renders availability from the API in *your* timezone with an explicit tz
   label and a "last synced" freshness cue, so stale data is never presented as truth.
2. Selecting a slot **creates a server-side hold** and opens the booking sheet with a **live
   5-minute countdown**. The hold survives an app kill; the slot is hidden from other patients
   for its lifetime.
3. **Payment** is a simulated gateway — no card data is collected or stored. The appointment is
   created *before* capture, so money can never be taken without a booking.
4. Every failure in the flow has a specific recovery:
   - `APT_SLOT_TAKEN` → "that slot was just taken" plus the **nearest alternatives**, bookable
     in place (nothing was charged);
   - `APT_HOLD_EXPIRED` → back to the slot picker, explicitly told nothing was charged;
   - `APT_HOLD_ACTIVE` → the previous hold is released and the new one acquired;
   - `PAY_FAILED` → retry offered while the hold is alive.
5. The booking POST carries a **stable idempotency key** generated once per draft, so a
   timeout-then-retry replays the original booking instead of creating a second one.

## State

- **Server state**: TanStack Query, with query keys that encode the viewer's timezone.
  Availability is `staleTime: 30s` and always refetched on the booking sheet.
- **Client state**: two tiny observable stores built on `useSyncExternalStore` —
  `sessionStore` (identity + tokens, persisted to `expo-secure-store`) and
  `bookingDraftStore` (the linear booking flow and its idempotency key). No extra dependency.
- **Tokens** live in SecureStore only; nothing sensitive goes to AsyncStorage.

## Offline guarantees

- Fonts are bundled from `@expo-google-fonts/*`; there are no remote images anywhere — every
  avatar is generated initials.
- Reads work fully offline against the mock; the booking sheet is the one place the PRD treats
  connectivity as required, and it fails loudly rather than optimistically.
- `npx expo export --platform ios` bundles cleanly, which is the check that nothing reaches for
  the network at build time.

## Verification

```bash
npm run typecheck:patient                                    # strict TS, exit 0
npx expo config --type public                                # resolves app config
npx expo export --platform ios --output-dir /tmp/patient-export   # real Metro bundle
```

## Simulated in this build

Payment gateway, add-to-calendar handoff (no native calendar module), the video call surface
(join window and room-token mint are real; the call is a placeholder) and OTP delivery. Each one
says so on screen rather than pretending.
